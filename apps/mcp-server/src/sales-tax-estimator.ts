export type SalesTaxEstimate = {
  amountCents: number;
  currency: "USD";
  jurisdiction: string;
  rateBasisPoints: number;
  source: "TAX_FOUNDATION_STATE_AVERAGE_2026";
};

// https://taxfoundation.org/data/all/state/sales-tax-rates/
// State plus population-weighted average local rate, 2026-01-01.
const COMBINED_RATE_BASIS_POINTS: Readonly<Record<string, number>> = {
  AL: 946, AK: 182, AZ: 852, AR: 946, CA: 899, CO: 789, CT: 635, DE: 0,
  DC: 600, FL: 698, GA: 749, HI: 450, ID: 603, IL: 896, IN: 700, IA: 694,
  KS: 869, KY: 600, LA: 1011, ME: 550, MD: 600, MA: 625, MI: 600, MN: 814,
  MS: 706, MO: 844, MT: 0, NE: 698, NV: 824, NH: 0, NJ: 660, NM: 767,
  NY: 854, NC: 700, ND: 709, OH: 729, OK: 906, OR: 0, PA: 634, RI: 700,
  SC: 749, SD: 611, TN: 961, TX: 820, UT: 742, VT: 639, VA: 577, WA: 951,
  WV: 659, WI: 572, WY: 556
};

type ZipRange = readonly [start: number, end: number, state: string];

// https://www.irs.gov/irm/part3/irm_03-041-267r
// IRS IRM 3.41.267, effective 2026-01-01. Unsupported territories and military ZIPs fail closed.
const ZIP_RANGES: readonly ZipRange[] = [
  [5, 5, "NY"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"],
  [39, 49, "ME"], [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"],
  [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"],
  [197, 199, "DE"], [200, 200, "DC"], [201, 201, "VA"], [202, 205, "DC"],
  [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"],
  [290, 299, "SC"], [300, 319, "GA"], [320, 342, "FL"], [344, 344, "FL"],
  [346, 347, "FL"], [349, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"],
  [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"],
  [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"],
  [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"],
  [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"],
  [700, 714, "LA"], [716, 729, "AR"], [730, 732, "OK"], [733, 733, "TX"],
  [734, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"],
  [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"],
  [889, 898, "NV"], [900, 908, "CA"], [910, 961, "CA"], [967, 968, "HI"],
  [970, 979, "OR"], [980, 986, "WA"], [988, 994, "WA"], [995, 999, "AK"]
];

const ZIP_EXCEPTIONS: Readonly<Record<string, string>> = {
  "03801": "ME", "06390": "NY", "20041": "VA", "20301": "VA", "20331": "MD",
  "20370": "VA", "45275": "KY", "49936": "WI", "71749": "LA", "73949": "TX",
  "75502": "AR"
};

export function estimateSalesTax(zipCode: string, taxableAmountCents: number): SalesTaxEstimate | undefined {
  if (!/^\d{5}(?:-\d{4})?$/u.test(zipCode)) return undefined;
  if (!Number.isSafeInteger(taxableAmountCents) || taxableAmountCents < 0) return undefined;
  const zip = zipCode.slice(0, 5);
  const prefix = Number(zip.slice(0, 3));
  const jurisdiction = ZIP_EXCEPTIONS[zip] ?? ZIP_RANGES.find(([start, end]) =>
    prefix >= start && prefix <= end
  )?.[2];
  if (jurisdiction === undefined) return undefined;
  const rateBasisPoints = COMBINED_RATE_BASIS_POINTS[jurisdiction];
  if (rateBasisPoints === undefined) return undefined;
  return {
    amountCents: Math.round(taxableAmountCents * rateBasisPoints / 10_000),
    currency: "USD",
    jurisdiction,
    rateBasisPoints,
    source: "TAX_FOUNDATION_STATE_AVERAGE_2026"
  };
}
