// 지정학적 데이터 인터페이스
export interface GeopoliticalData {
  countries: string[];
  regions: string[];
  organizations: string[];
  events: string[];
}

// 뉴스 기사 인터페이스 정의
export interface NewsArticleInfo {
  title: string;
  url: string;
  source: string;
  content?: string;
  author?: string | null;
  tags?: string[];
  publishedAt: Date;
  metadata?: Record<string, any>;
  geopoliticalData?: GeopoliticalData;
  contentKey?: string;
}

// 뉴스 소스 인터페이스 정의
export interface NewsSource {
  name: string;
  url: string;
  selector: string;
  titleSelector: string;
  linkSelector: string;
  baseUrl: string;
}
