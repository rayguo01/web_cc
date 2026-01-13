/**
 * Domain Trends 类型定义
 */

// 领域配置
export interface DomainConfig {
  id: string;
  name: string;
  description: string;
  hoursAgo?: number;  // 搜索最近N小时的推文，默认24小时
  query: {
    keywords: string[];
    hashtags: string[];
    minLikes: number;
    minRetweets?: number;
    languages: string[];
    excludeRetweets: boolean;
  };
  kols: {
    enabled: boolean;
    accounts: string[];
    minLikes: number;
    tweetsPerKol: number;
  };
  fetchCount: number;
}

// 推文数据
export interface DomainTweet {
  id: string;
  text: string;
  author: string;
  authorFollowers: number;
  likes: number;
  retweets: number;
  replies: number;
  hashtags: string[];
  createdAt: string;
  url: string;
  source: 'search' | 'kol';
  isKol: boolean;
}

// 趋势项
export interface DomainTrendItem {
  rank: number;
  topic: string;
  engagement: number;
  tweetCount: number;
  topTweet: DomainTweet;
  url: string;
}

// API 原始推文格式
export interface RawTweet {
  id: string;
  text: string;
  author: {
    userName: string;
    name: string;
    followersCount: number;
  };
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  createdAt: string;
  entities?: {
    hashtags?: Array<{ text: string }>;
  };
}

// API 搜索响应
export interface SearchResponse {
  tweets: RawTweet[];
  has_next_page: boolean;
  next_cursor: string;
}

// 聚合话题
export interface AggregatedTopic {
  topic: string;
  tweets: DomainTweet[];
  totalLikes: number;
  totalRetweets: number;
  engagement: number;
}
