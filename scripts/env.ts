/** 로컬 배치 실행 시 .env.local → .env 순으로 로드 (GitHub Actions 는 secrets 를 env 로 직접 주입) */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
