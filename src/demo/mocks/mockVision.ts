/**
 * Mock vision verification results for demo mode.
 *
 * Allows queuing specific pass/fail outcomes for proof-of-work photo verification.
 * This simulates the Venice/GPT-4o vision model without making real API calls.
 */
import { demoLog } from '../../config/constants.ts';

export interface MockVisionResult {
  score: number;
  approved: boolean;
  reasoning: string;
  matchedIndicators: string[];
  flagsTriggered: string[];
  model: string;
}

const visionQueue: MockVisionResult[] = [];

const GOOD_WORK_RESULT: MockVisionResult = {
  score: 0.82,
  approved: true,
  reasoning: 'Photo shows cleared understory with visible cut stumps at ground level. Herbicide dye marks visible on 3 stump cuts. Canopy is noticeably more open compared to surrounding area. Bagged debris visible at edge of frame.',
  matchedIndicators: [
    'Cut stumps at or near ground level',
    'Visible herbicide application marks',
    'Opening in canopy/understory',
    'Bagged or piled debris',
  ],
  flagsTriggered: [],
  model: 'demo-vision-v1',
};

const BAD_WORK_RESULT: MockVisionResult = {
  score: 0.31,
  approved: false,
  reasoning: 'Photo appears to show an unmodified lot. No cut stumps visible. Invasive shrub layer appears intact. No signs of herbicide application. No debris bags or cleared areas detected. Photo may be a pre-work baseline rather than proof of completed work.',
  matchedIndicators: [],
  flagsTriggered: [
    'No visible cut stumps or clearing',
    'Invasive canopy appears intact',
    'No herbicide marks detected',
    'Possible pre-work photo submitted as proof',
  ],
  model: 'demo-vision-v1',
};

const PARTIAL_WORK_RESULT: MockVisionResult = {
  score: 0.54,
  approved: false,
  reasoning: 'Photo shows some disturbance but work appears incomplete. A few cut stumps visible but many invasive stems remain standing. No herbicide marks detected - resprouting is likely without chemical treatment. Approximately 30% of target area appears cleared.',
  matchedIndicators: [
    'Some cut stumps visible',
  ],
  flagsTriggered: [
    'Work appears incomplete - many stems remain',
    'No herbicide marks - resprouting likely',
    'Less than 50% of target area cleared',
  ],
  model: 'demo-vision-v1',
};

export const mockVision = {
  /** Queue a passing vision result */
  queueGoodWork() {
    visionQueue.push(GOOD_WORK_RESULT);
    demoLog('Queued vision result: GOOD WORK (score 0.82, approved)');
  },

  /** Queue a failing vision result - no work done */
  queueBadWork() {
    visionQueue.push(BAD_WORK_RESULT);
    demoLog('Queued vision result: BAD WORK (score 0.31, rejected)');
  },

  /** Queue a failing vision result - incomplete work */
  queuePartialWork() {
    visionQueue.push(PARTIAL_WORK_RESULT);
    demoLog('Queued vision result: PARTIAL WORK (score 0.54, rejected)');
  },

  /** Queue a custom result */
  queueCustom(result: MockVisionResult) {
    visionQueue.push(result);
    demoLog(`Queued custom vision result (score ${result.score}, ${result.approved ? 'approved' : 'rejected'})`);
  },

  /** Pop the next queued result, or return good work by default */
  getNext(): MockVisionResult {
    const result = visionQueue.length > 0 ? visionQueue.shift()! : GOOD_WORK_RESULT;
    demoLog(`Vision verify → score ${result.score}, ${result.approved ? 'APPROVED' : 'REJECTED'}: ${result.reasoning.substring(0, 80)}...`);
    return result;
  },

  /** Check if there are queued results */
  hasQueued(): boolean {
    return visionQueue.length > 0;
  },
};
