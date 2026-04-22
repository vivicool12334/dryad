/**
 * Vision-based work verification service.
 * Analyzes contractor-submitted photos against work order descriptions
 * using a vision-capable LLM (Venice AI / OpenAI-compatible).
 *
 * Flow:
 *   1. Contractor uploads proof-of-work photo
 *   2. This service sends the image + work context to a vision model
 *   3. Model returns a structured assessment (score, reasoning, flags)
 *   4. Score determines auto-approve vs. flag-for-review
 */
import * as fs from 'fs';
import { logger } from '@elizaos/core';
import { audit } from './auditLog.ts';
import { DEMO_MODE, demoLog } from '../config/constants.ts';
import type { MockVisionResult } from '../demo/mocks/mockVision.ts';

// Lazy-load mock vision to avoid build-time resolution when demo/ doesn't exist
interface MockVisionModule {
  getNext: () => MockVisionResult;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const FALLBACK_MOCK_RESULT: MockVisionResult = {
  score: 0.75,
  approved: true,
  reasoning: 'mock fallback',
  matchedIndicators: [],
  flagsTriggered: [],
  model: 'mock-fallback',
};

let mockVision: MockVisionModule | null = null;
function getMockVision(): MockVisionModule {
  if (!mockVision) {
    try {
      const p = ['..', 'demo', 'mocks', 'mockVision.ts'].join('/');
      const loaded = require(p) as { mockVision?: MockVisionModule; getNext?: () => MockVisionResult };
      mockVision = loaded.mockVision || (loaded.getNext ? { getNext: loaded.getNext } : null);
    } catch {
      mockVision = null;
    }
  }
  return mockVision || { getNext: () => FALLBACK_MOCK_RESULT };
}

// ---------------------------------------------------------------------------
// Work-type visual checklists
// ---------------------------------------------------------------------------

export interface VisualChecklist {
  description: string;
  expectedIndicators: string[];
  redFlags: string[];
  minPhotos?: number;
}

/**
 * Maps work types to what the vision model should look for.
 * These get injected into the analysis prompt so the model knows
 * exactly which visual evidence supports or contradicts the claim.
 */
const WORK_TYPE_CHECKLISTS: Record<string, VisualChecklist> = {
  'invasive_removal': {
    description: 'Removal of invasive plant species (buckthorn, honeysuckle, phragmites, etc.)',
    expectedIndicators: [
      'Cut stumps at or near ground level',
      'Cleared brush or vegetation piles',
      'Herbicide marking (dye on stumps)',
      'Visible opening in canopy or understory where plants were removed',
      'Bagged plant material or debris ready for disposal',
      'Before/after difference showing reduced vegetation density',
    ],
    redFlags: [
      'Photo appears to be indoors or not at a vegetated site',
      'No visible signs of cutting, clearing, or removal work',
      'Healthy invasive plants still standing with no evidence of treatment',
      'Photo is blurry, dark, or unrecognizable',
      'Photo appears to be a stock image or screenshot',
    ],
  },
  'native_planting': {
    description: 'Planting native species (grasses, wildflowers, trees, shrubs)',
    expectedIndicators: [
      'Freshly planted seedlings, plugs, or seeds visible in soil',
      'Mulch rings or protective cages around new plantings',
      'Disturbed soil indicating recent planting activity',
      'Plant tags, labels, or nursery containers nearby',
      'Rows or deliberate spacing pattern of new plants',
      'Watering equipment or irrigation visible',
    ],
    redFlags: [
      'No visible new plantings in the photo',
      'Site looks undisturbed - no soil work or planting evidence',
      'Photo is indoors or clearly not at the work site',
      'Only mature, established plants visible (no new plantings)',
    ],
  },
  'mowing': {
    description: 'Mowing or cutting of grass/weeds on the lot',
    expectedIndicators: [
      'Freshly cut grass with visible mowing lines or patterns',
      'Short, uniform grass height across the lot',
      'Grass clippings on the ground',
      'Mowing equipment visible in photo',
      'Clear contrast between mowed area and unmowed edges',
    ],
    redFlags: [
      'Grass appears tall and uncut',
      'No visible mowing lines or patterns',
      'Photo does not show an outdoor lot or yard',
    ],
  },
  'trash_cleanup': {
    description: 'Removal of litter, debris, and illegal dumping from the lot',
    expectedIndicators: [
      'Collected trash bags visible',
      'Clean, debris-free ground surface',
      'Visible improvement from a messy or littered state',
      'Dumpster or waste receptacle with collected items',
      'Worker with pickup tools, gloves, or bags',
    ],
    redFlags: [
      'Litter and debris still scattered across the site',
      'Photo does not show a lot or outdoor area',
      'No evidence of cleanup activity',
    ],
  },
  'site_assessment': {
    description: 'General site visit and condition assessment',
    expectedIndicators: [
      'Photo shows a vacant lot or green space in Detroit',
      'Visible vegetation, soil, or structures on the lot',
      'Photo taken at eye level from the lot or sidewalk',
      'Identifiable features matching the parcel (fences, trees, adjacent structures)',
    ],
    redFlags: [
      'Photo is indoors or clearly not at a vacant lot',
      'Photo is too zoomed in to show the site',
      'Photo appears to be from a moving vehicle',
    ],
  },
};

// Default checklist for work types not in the map
const DEFAULT_CHECKLIST: VisualChecklist = {
  description: 'General land management work',
  expectedIndicators: [
    'Photo shows an outdoor lot or green space',
    'Evidence of physical work having been performed',
    'Tools, equipment, or materials visible',
    'Visible change or improvement to the site',
  ],
  redFlags: [
    'Photo is indoors or unrelated to land management',
    'No evidence of any work performed',
    'Photo is blurry, dark, or unrecognizable',
    'Photo appears to be a stock image or screenshot',
  ],
};

// ---------------------------------------------------------------------------
// Vision verification result
// ---------------------------------------------------------------------------

export interface VisionVerificationResult {
  score: number;             // 0.0–1.0 confidence that the photo shows the claimed work
  approved: boolean;         // score >= threshold
  reasoning: string;         // Model's explanation
  matchedIndicators: string[];  // Which expected indicators were found
  flagsTriggered: string[];    // Which red flags were detected
  workType: string;
  model: string;             // Which model was used
  timestamp: number;
  error?: string;            // Set if verification failed entirely
}

const APPROVAL_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Build the analysis prompt
// ---------------------------------------------------------------------------

function buildVerificationPrompt(
  workType: string,
  workDescription: string,
  parcelAddress: string,
  contractorName?: string,
): string {
  const checklist = WORK_TYPE_CHECKLISTS[workType] || DEFAULT_CHECKLIST;

  return `You are a land management verification system for Dryad, an autonomous agent managing 9 vacant lots on 25th Street in Detroit, Michigan. A contractor has submitted a photo as proof that they completed work on one of these parcels.

## Work Order Details
- **Work type:** ${checklist.description}
- **Specific task:** ${workDescription}
- **Parcel:** ${parcelAddress}
${contractorName ? `- **Contractor:** ${contractorName}` : ''}

## Your Task
Analyze this photo and determine whether it shows evidence consistent with the claimed work. You are looking at a photo that was allegedly taken at a vacant urban lot in Detroit after the work described above was performed.

## Expected Visual Indicators (look for these)
${checklist.expectedIndicators.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

## Red Flags (watch for these)
${checklist.redFlags.map((f, idx) => `${idx + 1}. ${f}`).join('\n')}

## Response Format
Respond with ONLY a valid JSON object (no markdown, no code fences):
{
  "score": <number 0.0-1.0>,
  "reasoning": "<2-3 sentence explanation>",
  "matched_indicators": ["<indicator text>", ...],
  "flags_triggered": ["<flag text>", ...],
  "scene_description": "<1 sentence: what does the photo actually show?>"
}

Scoring guide:
- 0.8–1.0: Clear evidence of the claimed work, multiple indicators present
- 0.6–0.79: Likely shows the claimed work but some ambiguity
- 0.4–0.59: Uncertain - could be the claimed work but evidence is weak
- 0.2–0.39: Unlikely to show the claimed work
- 0.0–0.19: Photo clearly does not show the claimed work or is unrelated`;
}

// ---------------------------------------------------------------------------
// Build before/after comparison prompt
// ---------------------------------------------------------------------------

function buildBeforeAfterPrompt(
  workType: string,
  workDescription: string,
  parcelAddress: string,
): string {
  const checklist = WORK_TYPE_CHECKLISTS[workType] || DEFAULT_CHECKLIST;

  return `You are a land management verification system for Dryad. You are comparing a BEFORE photo and an AFTER photo of the same parcel to verify that work was performed.

## Work Order Details
- **Work type:** ${checklist.description}
- **Specific task:** ${workDescription}
- **Parcel:** ${parcelAddress}

## Your Task
The first image is the BEFORE photo (taken before work began). The second image is the AFTER photo (submitted as proof of work). Compare them and determine:
1. Do both photos appear to show the same site?
2. Is there visible evidence that the described work was performed between the two photos?
3. How significant is the change?

## Expected Changes for "${workType}"
${checklist.expectedIndicators.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

## Response Format
Respond with ONLY a valid JSON object (no markdown, no code fences):
{
  "score": <number 0.0-1.0>,
  "reasoning": "<2-3 sentence explanation of what changed>",
  "same_site": <boolean>,
  "matched_indicators": ["<indicator text>", ...],
  "flags_triggered": ["<flag text>", ...],
  "before_description": "<1 sentence: what the before photo shows>",
  "after_description": "<1 sentence: what the after photo shows>"
}`;
}

// ---------------------------------------------------------------------------
// Call the vision model
// ---------------------------------------------------------------------------

async function callVisionModel(
  prompt: string,
  imageBuffers: Buffer[],
): Promise<{ text: string; model: string }> {
  const veniceKey = process.env.VENICE_API_KEY;
  const veniceBaseUrl = process.env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1';
  // Use the large model for vision tasks - more capable for image analysis
  const veniceVisionModel = process.env.VENICE_VISION_MODEL || process.env.VENICE_LARGE_MODEL || 'qwen/qwen-2.5-vl';

  // Build content array with text + images
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: prompt },
  ];

  for (const buf of imageBuffers) {
    const base64 = buf.toString('base64');
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${base64}` },
    });
  }

  // Try Venice API first (OpenAI-compatible)
  if (veniceKey) {
    try {
      const resp = await fetch(`${veniceBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${veniceKey}`,
        },
        body: JSON.stringify({
          model: veniceVisionModel,
          messages: [{ role: 'user', content }],
          max_tokens: 500,
          temperature: 0.1, // Low temp for consistent scoring
          venice_parameters: { disable_thinking: true, include_venice_system_prompt: false },
        }),
        signal: AbortSignal.timeout(30000), // 30s timeout for image analysis
      });

      if (resp.ok) {
        const data = (await resp.json()) as ChatCompletionResponse;
        const text = data?.choices?.[0]?.message?.content || '';
        return { text, model: veniceVisionModel };
      }

      logger.warn(`[Dryad Vision] Venice API error: ${resp.status}`);
    } catch (error) {
      logger.warn(`[Dryad Vision] Venice call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Fallback: try OpenAI if configured
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content }],
          max_tokens: 500,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        const data = (await resp.json()) as ChatCompletionResponse;
        const text = data?.choices?.[0]?.message?.content || '';
        return { text, model: 'gpt-4o-mini' };
      }
    } catch (error) {
      logger.warn(`[Dryad Vision] OpenAI fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error('No vision-capable model available. Set VENICE_API_KEY or OPENAI_API_KEY.');
}

// ---------------------------------------------------------------------------
// Parse the model's JSON response
// ---------------------------------------------------------------------------

function parseVerificationResponse(raw: string): {
  score: number;
  reasoning: string;
  matchedIndicators: string[];
  flagsTriggered: string[];
} {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      score: Math.max(0, Math.min(1, Number(parsed.score) || 0)),
      reasoning: String(parsed.reasoning || 'No reasoning provided'),
      matchedIndicators: Array.isArray(parsed.matched_indicators) ? parsed.matched_indicators : [],
      flagsTriggered: Array.isArray(parsed.flags_triggered) ? parsed.flags_triggered : [],
    };
  } catch {
    // If JSON parsing fails, try to extract a score from the text
    const scoreMatch = raw.match(/"score"\s*:\s*([\d.]+)/);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
    return {
      score: Math.max(0, Math.min(1, score)),
      reasoning: `Failed to parse structured response. Raw: ${raw.slice(0, 200)}`,
      matchedIndicators: [],
      flagsTriggered: ['Response parsing failed - manual review recommended'],
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a single proof-of-work photo against its work description.
 */
export async function verifyWorkPhoto(opts: {
  photoPath: string;
  workType: string;
  workDescription: string;
  parcelAddress: string;
  contractorName?: string;
}): Promise<VisionVerificationResult> {
  const { photoPath, workType, workDescription, parcelAddress, contractorName } = opts;

  // In demo mode, return mock vision results instead of calling a real vision model
  if (DEMO_MODE) {
    const mock = getMockVision().getNext();
    demoLog(`Vision verify (DEMO) for ${workType} at ${parcelAddress}: score=${mock.score}, approved=${mock.approved}`);
    audit('VISION_VERIFY', `DEMO: ${parcelAddress} - score ${mock.score} ${mock.approved ? 'APPROVED' : 'REJECTED'}`, 'visionVerify', mock.approved ? 'info' : 'warn');
    return {
      score: mock.score,
      approved: mock.approved,
      reasoning: mock.reasoning,
      matchedIndicators: mock.matchedIndicators,
      flagsTriggered: mock.flagsTriggered,
      workType,
      model: mock.model,
      timestamp: Date.now(),
    };
  }

  try {
    // Read the photo file
    if (!fs.existsSync(photoPath)) {
      return {
        score: 0,
        approved: false,
        reasoning: `Photo file not found: ${photoPath}`,
        matchedIndicators: [],
        flagsTriggered: ['Photo file missing'],
        workType,
        model: 'none',
        timestamp: Date.now(),
        error: 'Photo file not found',
      };
    }

    const imageBuffer = fs.readFileSync(photoPath);

    // Sanity check: is this actually an image?
    if (imageBuffer.length < 1000) {
      return {
        score: 0,
        approved: false,
        reasoning: 'File is too small to be a valid photo',
        matchedIndicators: [],
        flagsTriggered: ['Invalid file size'],
        workType,
        model: 'none',
        timestamp: Date.now(),
        error: 'File too small',
      };
    }

    const prompt = buildVerificationPrompt(workType, workDescription, parcelAddress, contractorName);
    const { text, model } = await callVisionModel(prompt, [imageBuffer]);
    const parsed = parseVerificationResponse(text);

    const result: VisionVerificationResult = {
      ...parsed,
      approved: parsed.score >= APPROVAL_THRESHOLD,
      workType,
      model,
      timestamp: Date.now(),
    };

    // Audit the verification
    const status = result.approved ? 'info' : 'warn';
    audit(
      'VISION_VERIFY',
      `${workType} @ ${parcelAddress}: score=${result.score.toFixed(2)} approved=${result.approved} model=${model}`,
      'vision_verify',
      status,
    );

    logger.info(
      `[Dryad Vision] ${parcelAddress} ${workType}: score=${result.score.toFixed(2)} approved=${result.approved}`,
    );

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[Dryad Vision] Verification failed: ${errorMsg}`);
    audit('VISION_VERIFY', `ERROR: ${errorMsg}`, 'vision_verify', 'critical');

    return {
      score: 0,
      approved: false,
      reasoning: `Vision verification failed: ${errorMsg}`,
      matchedIndicators: [],
      flagsTriggered: ['Verification system error - manual review required'],
      workType,
      model: 'none',
      timestamp: Date.now(),
      error: errorMsg,
    };
  }
}

/**
 * Compare before and after photos to verify work was performed.
 * Returns a higher-confidence result than single-photo verification.
 */
export async function verifyBeforeAfter(opts: {
  beforePhotoPath: string;
  afterPhotoPath: string;
  workType: string;
  workDescription: string;
  parcelAddress: string;
}): Promise<VisionVerificationResult> {
  const { beforePhotoPath, afterPhotoPath, workType, workDescription, parcelAddress } = opts;

  // Demo mode: use mock vision
  if (DEMO_MODE) {
    const mock = getMockVision().getNext();
    demoLog(`Vision before/after (DEMO) for ${workType} at ${parcelAddress}: score=${mock.score}`);
    audit('VISION_VERIFY_COMPARE', `DEMO: ${parcelAddress} - score ${mock.score}`, 'visionVerify', mock.approved ? 'info' : 'warn');
    return {
      score: mock.score, approved: mock.approved, reasoning: mock.reasoning,
      matchedIndicators: mock.matchedIndicators, flagsTriggered: mock.flagsTriggered,
      workType, model: mock.model, timestamp: Date.now(),
    };
  }

  try {
    if (!fs.existsSync(beforePhotoPath)) {
      return {
        score: 0, approved: false, reasoning: 'Before photo not found',
        matchedIndicators: [], flagsTriggered: ['Before photo missing'],
        workType, model: 'none', timestamp: Date.now(), error: 'Before photo not found',
      };
    }
    if (!fs.existsSync(afterPhotoPath)) {
      return {
        score: 0, approved: false, reasoning: 'After photo not found',
        matchedIndicators: [], flagsTriggered: ['After photo missing'],
        workType, model: 'none', timestamp: Date.now(), error: 'After photo not found',
      };
    }

    const beforeBuffer = fs.readFileSync(beforePhotoPath);
    const afterBuffer = fs.readFileSync(afterPhotoPath);

    const prompt = buildBeforeAfterPrompt(workType, workDescription, parcelAddress);
    const { text, model } = await callVisionModel(prompt, [beforeBuffer, afterBuffer]);
    const parsed = parseVerificationResponse(text);

    const result: VisionVerificationResult = {
      ...parsed,
      approved: parsed.score >= APPROVAL_THRESHOLD,
      workType,
      model,
      timestamp: Date.now(),
    };

    audit(
      'VISION_VERIFY_COMPARE',
      `Before/after ${workType} @ ${parcelAddress}: score=${result.score.toFixed(2)} approved=${result.approved}`,
      'vision_verify',
      result.approved ? 'info' : 'warn',
    );

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[Dryad Vision] Before/after verification failed: ${errorMsg}`);
    return {
      score: 0, approved: false,
      reasoning: `Before/after verification failed: ${errorMsg}`,
      matchedIndicators: [], flagsTriggered: ['Verification system error'],
      workType, model: 'none', timestamp: Date.now(), error: errorMsg,
    };
  }
}
