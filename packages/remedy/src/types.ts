export interface ErrorSignature {
  projectId: string;
  file: string;
  line: number;
  functionName: string;
  errorType: string;
  message: string;
  occurrences: number;
  uniqueSessions: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ProjectRepo {
  projectId: string;
  repoUrl: string;
  defaultBranch: string;
  githubOwner: string;
  githubRepo: string;
  slackWebhookUrl: string;
  notifyEmails: string[];
  enabled: boolean;
}

export interface AgentResult {
  success: boolean;
  diffSummary: string;
  filesChanged: string[];
  log: string;
  error?: string;
}

export interface RemedyPR {
  url: string;
  number: number;
  branch: string;
}

export type AttemptStatus =
  | "started"
  | "no_changes"
  | "pr_opened"
  | "agent_failed"
  | "pr_failed"
  | "resolver_failed";
