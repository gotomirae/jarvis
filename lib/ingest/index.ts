import { flywheel } from "./flywheel";
import { heimdallr } from "./heimdallr";
import { hermescall } from "./hermescall";
import { sage } from "./sage";
import { snowball } from "./snowball";
import type { SourceAdapter } from "./types";

/** 5개 소스 어댑터 (PRD §5). 순서 = 실측 보고 순서. */
export const ADAPTERS: SourceAdapter[] = [snowball, heimdallr, hermescall, sage, flywheel];
