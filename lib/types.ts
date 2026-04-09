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
