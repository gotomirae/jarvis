/**
 * config/*.yaml 로더 (CLAUDE.md "설정 단일 출처"). 임계값·URL·산업명은 여기서 읽은 값만 쓴다.
 * 서버·배치 전용(fs). 결과는 프로세스 수명 동안 캐시한다.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const cache = new Map<string, unknown>();

export function configPath(name: string): string {
  return path.join(process.cwd(), "config", name);
}

export function loadYaml<T = Record<string, unknown>>(name: string): T {
  if (!cache.has(name)) cache.set(name, parse(fs.readFileSync(configPath(name), "utf8")));
  return cache.get(name) as T;
}

export type TaxonomyConfig = {
  l1: { code: string; name: string; l2: string[]; synonyms: string[] }[];
  notion: {
    l1_urls: Record<string, string>;
    l2_page_ids: Record<string, string>;
    flywheel_monitoring: {
      date_property: string;
      strength_property: string;
      linked_marker: string;
      db_ids: Record<string, string>;
    };
  };
};

export type LinksConfig = {
  dashboards: Record<string, { label: string; url: string }>;
  stock: Record<string, Record<string, unknown>>;
  layout: Record<string, unknown>;
};

export const taxonomyConfig = () => loadYaml<TaxonomyConfig>("taxonomy.yaml");
export const linksConfig = () => loadYaml<LinksConfig>("links.yaml");
export const rulesConfig = () => loadYaml("rules.yaml");
export const industryGrowthConfig = () => loadYaml<IndustryGrowthConfig>("industry_growth.yaml");

export type IndustryGrowthConfig = {
  us_major_brokers: { name: string; aliases: string[] }[];
  news_search: {
    recency_days: number;
    user_agent: string;
    per_domain_delay_sec: number;
    sources: {
      google_news_rss: { enabled: boolean; url_en: string; url_ko: string };
      bing_news_rss: { enabled: boolean; url: string };
      gdelt_doc: { enabled: boolean; url: string; min_interval_sec: number; backoff_sec?: number[] };
      broker_sites: { enabled: boolean; pages: BrokerPage[] };
    };
    query_templates: { en: string; ko: string; bing_en: string; gdelt: string };
    segments_en: Record<string, string[]>;
  };
};

export type BrokerPage = { broker: string; list_url: string; sitemap?: string; url_pattern?: string; sitemap_has_lastmod?: boolean };
