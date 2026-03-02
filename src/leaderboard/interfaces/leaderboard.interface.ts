export interface UserSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  score: string;
}

export interface LeaderboardEntry {
  position: number;
  user: UserSummary;
}

export interface LeaderboardTopResponse {
  data: LeaderboardEntry[];
  meta: {
    limitRequested: number | undefined;
    limitApplied: number;
    total: number;
  };
}

export interface LeaderboardUserResponse {
  position: number;
  user: UserSummary;
  neighbors: {
    above: LeaderboardEntry[];
    below: LeaderboardEntry[];
  };
}
