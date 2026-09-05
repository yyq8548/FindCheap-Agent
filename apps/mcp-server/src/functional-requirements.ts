/** Bounded language normalization, not ingredient-to-efficacy inference. */
const functions = [
  { name: "anti-dandruff", request: /^(?:anti[- ]?dandruff(?: shampoo)?|dandruff control|去屑|去头屑|有头屑)$/iu,
    evidence: /\b(?:anti[- ]?dandruff|dandruff control|(?:helps? (?:to )?)?(?:reduce|reduces|control|controls|treat|treats) dandruff)\b|去(?:头)?屑/giu },
  { name: "oily scalp", request: /^(?:(?:suitable |ideal |recommended )?for )?(?:oily scalp|oily hair and scalp)$|^(?:油性头皮|头皮偏油|偏油|适合油性头皮)$/iu,
    evidence: /\b(?:(?:suitable |ideal |recommended )?for )?(?:oily scalp|oily hair and scalp)\b|(?:适合)?油性头皮/giu }
] as const;

export function functionalRequirement(value: string): string | undefined {
  return functions.find(entry => entry.request.test(value.normalize("NFKC").trim()))?.name;
}

export function functionalFeatureStatus(text: string, feature: string): "MATCHED" | "CONTRADICTED" | "UNKNOWN" | undefined {
  const name = functionalRequirement(feature);
  const entry = functions.find(item => item.name === name);
  if (entry === undefined) return undefined;
  let matched = false;
  let contradicted = false;
  for (const match of text.matchAll(new RegExp(entry.evidence))) {
    const before = text.slice(Math.max(0, match.index! - 65), match.index).split(/[.;!?。；！？\n]/u).at(-1)!;
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 65).split(/[.;!?。；！？\n]/u)[0]!;
    if (/\b(?:not|no|never|without|unsuitable|avoid|isn['’]t|doesn['’]t)\b|不(?:适合|适用|推荐|具备|具有|含)?|非/iu.test(before) ||
      /^(?:\s+\w+){0,3}\s+(?:sold separately|not included)\b|另售|不适用/iu.test(after)) contradicted = true;
    else if (name !== "oily scalp" || /\bfor\b|适合/u.test(match[0]) ||
      /^\s*(?:shampoo|专用|适用)/iu.test(after)) matched = true;
  }
  return contradicted ? "CONTRADICTED" : matched ? "MATCHED" : "UNKNOWN";
}

export function functionalQueryFeatures(features: readonly string[]): string[] {
  const known = functions.filter(entry => features.some(value => functionalRequirement(value) === entry.name));
  // The most discriminating function leads retrieval. All requirements still
  // participate in final validation; long prose is never an all-token query.
  return known.length === 0 ? [...features] : [known[0]!.name,
    ...features.filter(value => functionalRequirement(value) === undefined)];
}
