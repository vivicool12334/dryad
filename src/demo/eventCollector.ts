/**
 * Demo Event Collector
 *
 * Captures every meaningful event during a demo run into a structured timeline.
 * The report generator consumes this to build the proof report HTML.
 *
 * Events are grouped by scenario. Each event has a type, timestamp, and
 * scenario-specific payload that the report template knows how to render.
 */

export type EventType =
  | 'demo_start'
  | 'scenario_start'
  | 'scenario_end'
  | 'loop_cycle_start'
  | 'loop_cycle_end'
  | 'loop_step'
  | 'invasive_detected'
  | 'contractor_email_sent'
  | 'vision_verify'
  | 'payment_sent'
  | 'payment_blocked'
  | 'security_test'
  | 'treasury_check'
  | 'treasury_mode_change'
  | 'diem_check'
  | 'biodiversity_check'
  | 'milestone_recorded'
  | 'self_assessment'
  | 'weekly_report'
  | 'config_summary'
  | 'demo_end';

type DemoJsonPrimitive = string | number | boolean | null;
interface DemoJsonObject {
  [key: string]: DemoJsonValue;
}
type DemoJsonValue = DemoJsonPrimitive | DemoJsonObject | DemoJsonValue[];

export interface SecurityTestResult {
  name: string;
  amount: number;
  target: string;
  result: string;
  blocked: boolean;
}

export interface DemoConfigSummary {
  cycleIntervalSec: number;
  maxPerTxUsd: number;
  maxDailyUsd: number;
  sustainabilityTarget: number;
  annualOperatingCost: number;
  stethApr: number;
  chain: string;
  coolingOffMin: number;
}

interface EventPayloadByType {
  demo_start: Record<string, never>;
  scenario_start: { number: number; title: string };
  scenario_end: { number: number; passed: boolean; summary: string };
  loop_cycle_start: DemoJsonObject;
  loop_cycle_end: DemoJsonObject;
  loop_step: DemoJsonObject;
  invasive_detected: DemoJsonObject;
  contractor_email_sent: DemoJsonObject;
  vision_verify: DemoJsonObject;
  payment_sent: DemoJsonObject;
  payment_blocked: DemoJsonObject;
  security_test: { tests: SecurityTestResult[] };
  treasury_check: DemoJsonObject;
  treasury_mode_change: DemoJsonObject;
  diem_check: DemoJsonObject;
  biodiversity_check: DemoJsonObject;
  milestone_recorded: DemoJsonObject;
  self_assessment: DemoJsonObject;
  weekly_report: DemoJsonObject;
  config_summary: DemoConfigSummary;
  demo_end: { totalEvents: number };
}

export type DemoEvent<T extends EventType = EventType> = T extends EventType ? {
  type: T;
  timestamp: number;
  scenario?: number;       // 1-8
  scenarioTitle?: string;
  data: EventPayloadByType[T];
} : never;

// ---------------------------------------------------------------------------
// Singleton collector
// ---------------------------------------------------------------------------

const events: DemoEvent[] = [];
let currentScenario = 0;
let currentScenarioTitle = '';

export function startScenario(num: number, title: string): void {
  currentScenario = num;
  currentScenarioTitle = title;
  record('scenario_start', { number: num, title });
}

export function endScenario(num: number, passed: boolean, summary: string): void {
  record('scenario_end', { number: num, passed, summary });
}

export function record<T extends EventType>(type: T, data: EventPayloadByType[T]): void {
  const event = {
    type,
    timestamp: Date.now(),
    scenario: currentScenario,
    scenarioTitle: currentScenarioTitle,
    data,
  } as DemoEvent<T>;
  events.push(event);
}

export function getAllEvents(): DemoEvent[] {
  return [...events];
}

export function getScenarioResults(): Array<{
  number: number;
  title: string;
  passed: boolean;
  summary: string;
  events: DemoEvent[];
}> {
  const scenarios = new Map<number, { title: string; passed: boolean; summary: string }>();

  for (const e of events) {
    if (e.type === 'scenario_start') {
      const data = e.data as EventPayloadByType['scenario_start'];
      scenarios.set(data.number, { title: data.title, passed: false, summary: '' });
    }
    if (e.type === 'scenario_end') {
      const data = e.data as EventPayloadByType['scenario_end'];
      const s = scenarios.get(data.number);
      if (s) {
        s.passed = data.passed;
        s.summary = data.summary;
      }
    }
  }

  return Array.from(scenarios.entries()).map(([num, info]) => ({
    number: num,
    ...info,
    events: events.filter(e => e.scenario === num),
  }));
}
