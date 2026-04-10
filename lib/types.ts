export type CompanyContextPayload = {
  companyName: string;
  websiteUrl: string;
};

export type InternalContextPayload = {
  whyRoleOpen: string;
  successIn90Days: string;
  nonNegotiables: string;
  hiringManagerStyle: string;
  teamStructure: string;
  whyLastPersonLeft?: string;
};

export type BriefingSections = {
  roleSummary: string;
  conceptDefinitions: string[];
  idealProfile: string;
  candidatePoolReality: string;
  searchDirection: {
    targetCompanies: string[];
    alternativeTitles: string[];
    sourcingChannels: string[];
  };
  keyDeliverablesAndMetrics: string[];
  hmMeetingPrep: string[];
};

export type NewRolePayload = {
  companyId: string;
  jobDescription: string;
  internalContext: InternalContextPayload;
};

export type ResumeCompanyEntry = {
  name: string;
  estimatedSize: string;
  estimatedStage: string;
};

/** Hover tooltip + transparency: how the model arrived at JD or role fit. */
export type ScoreBreakdown = {
  strengths: string[];
  weaknesses: string[];
  biggestFactor: string;
};

export type ResumeAnalysisPayload = {
  fullName: string;
  currentTitle: string;
  totalYearsExperience: number;
  relevantYearsForRole: number;
  companies: ResumeCompanyEntry[];
  industryBackground: string;
  averageTenureYearsPerRole: number;
  keyMetricsRelevantToRole: string[];
  careerTrajectory: "ascending" | "lateral" | "descending";
  missingForRole: string[];
  employmentGaps: string[];
  keySignals: string[];
  suggestedScreeningQuestions: string[];
  jdFitScore: number;
  roleFitScore: number;
  jdFitRationale: string;
  roleFitRationale: string;
  jdFitBreakdown: ScoreBreakdown;
  roleFitBreakdown: ScoreBreakdown;
  rawText?: string;
};

export type FeedbackType = "shortlist" | "reject" | "hold";

export type RejectReason =
  | "Overqualified"
  | "Underqualified"
  | "Wrong industry"
  | "Poor stability"
  | "Missing skills"
  | "Other";

export type RoleScoringCalibration = {
  patternSummary: string;
  roleFitScoringGuidance: string;
  feedbackCount: number;
  updatedAt: string;
};
