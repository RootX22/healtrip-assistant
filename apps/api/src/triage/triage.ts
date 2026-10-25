import { type ScreeningAnswer, type Urgency, urgencySchema } from "@healtrip/contracts";
import { CHEST_PAIN_SCREEN, type ScreenDefinition } from "../i18n/messages.js";
import { detect, type RedFlag, type SymptomFamily } from "./red-flags.js";

type ScreenId = ScreenDefinition["id"];
export type ScreenStatus = "pending" | "cleared";

/** What triage remembers about a conversation between turns. */
export interface TriageState {
  emergency: boolean;
  flags: RedFlag[];
  families: SymptomFamily[];
  screens: Partial<Record<ScreenId, ScreenStatus>>;
}

export const initialTriageState = (): TriageState => ({
  emergency: false,
  flags: [],
  families: [],
  screens: {},
});

export type Assessment =
  | { kind: "emergency"; flags: RedFlag[] }
  | { kind: "screen"; screen: ScreenDefinition; repeat: boolean }
  | { kind: "proceed"; floor: Urgency | null; clearedScreens: ScreenId[] };

export interface TriageInput {
  text?: string | undefined;
  screening?: ScreeningAnswer | undefined;
}

interface Assessed {
  assessment: Assessment;
  state: TriageState;
}

interface FamilyPolicy {
  screen: ScreenDefinition;
  /** The least urgent advice the agent may give once this family has come up. */
  floor: Urgency;
}

const POLICIES: Record<SymptomFamily, FamilyPolicy> = {
  chest_pain: { screen: CHEST_PAIN_SCREEN, floor: "within_days" },
};

const SCREENS = new Map(Object.values(POLICIES).map((p) => [p.screen.id, p.screen]));

// The contract lists urgency most urgent first; rank counts up from routine.
const URGENCY_ORDER = [...urgencySchema.options].reverse();
export const urgencyRank = (urgency: Urgency): number => URGENCY_ORDER.indexOf(urgency);

/**
 * Decides, before any model runs, whether this turn is an emergency, needs a
 * safety checklist first, or can go to the agent, and with what minimum
 * urgency. Pure: same state and input, same answer.
 */
export function assess(state: TriageState, input: TriageInput): Assessed {
  // Once a conversation has raised an emergency it stays there. The patient
  // can start a new conversation; this one does not argue them out of it.
  if (state.emergency) return { assessment: { kind: "emergency", flags: state.flags }, state };

  const screened = applyScreeningAnswer(state, input.screening);
  if (screened.emergency) return emergency(screened, screened.flags);

  const { state: read, flags } = readText(screened, input.text);
  if (flags.length > 0) return emergency(read, flags);

  return askScreen(read) ?? proceed(read);
}

const emergency = (state: TriageState, flags: RedFlag[]): Assessed => ({
  assessment: { kind: "emergency", flags },
  state: { ...state, emergency: true, flags },
});

/** A ticked warning sign is an emergency; a clear checklist marks the screen cleared. */
function applyScreeningAnswer(
  state: TriageState,
  answer: ScreeningAnswer | undefined,
): TriageState {
  const screen = answer ? SCREENS.get(answer.id as ScreenId) : undefined;
  if (!answer || !screen || state.screens[screen.id] !== "pending") return state;
  const known = new Set(screen.items.map((item) => item.id));
  if (answer.positive.some((id) => known.has(id)))
    return { ...state, emergency: true, flags: ["cardiac"] };
  return { ...state, screens: { ...state.screens, [screen.id]: "cleared" } };
}

function readText(
  state: TriageState,
  text: string | undefined,
): { state: TriageState; flags: RedFlag[] } {
  if (!text) return { state, flags: [] };
  const detection = detect(text);
  const families = [...new Set([...state.families, ...detection.families])];
  const flags = [...detection.redFlags];
  // A warning sign counts even when the chest pain was mentioned turns ago.
  if (
    detection.cardiacWarningSign &&
    families.includes("chest_pain") &&
    !flags.includes("cardiac")
  ) {
    flags.push("cardiac");
  }
  return { state: { ...state, families }, flags };
}

function askScreen(state: TriageState): Assessed | null {
  for (const family of state.families) {
    const { screen } = POLICIES[family];
    const status = state.screens[screen.id];
    if (status === "cleared") continue;
    return {
      assessment: { kind: "screen", screen, repeat: status === "pending" },
      state: { ...state, screens: { ...state.screens, [screen.id]: "pending" } },
    };
  }
  return null;
}

function proceed(state: TriageState): Assessed {
  const floor = state.families
    .map((family) => POLICIES[family].floor)
    .reduce<Urgency | null>(
      (highest, f) => (highest === null || urgencyRank(f) > urgencyRank(highest) ? f : highest),
      null,
    );
  const clearedScreens = (Object.keys(state.screens) as ScreenId[]).filter(
    (id) => state.screens[id] === "cleared",
  );
  return { assessment: { kind: "proceed", floor, clearedScreens }, state };
}
