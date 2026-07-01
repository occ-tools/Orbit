import { ProjectIndex } from "@orbit-build/tools";

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
}

export interface ActiveSkill extends SkillSummary {
  content: string;
  activation: "explicit" | "auto";
  loadedBytes: number;
  truncated: boolean;
}

export interface ContextPack {
  projectInstructions: string;
  projectIndex: ProjectIndex;
  skillsIndex?: SkillSummary[];
  activeSkills?: ActiveSkill[];
  relevantFiles: Array<{
    path: string;
    reason: string;
    summary?: string;
    excerpt?: string;
    readOnly?: boolean;
  }>;
  recentChanges: string;
  currentDiff: string;
  previousErrors: string;
  codebaseContext?: string;
  tokenBudget: {
    max: number;
    usedEstimate: number;
  };
}
