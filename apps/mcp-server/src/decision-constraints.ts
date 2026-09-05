export type ChargingDecisionInput = {
  query?: string | undefined;
  productType?: string | undefined;
  primaryUse?: string | undefined;
  requiredFeatures?: readonly string[] | undefined;
  preferences?: readonly string[] | undefined;
  requiredSize?: string | undefined;
  preferredSize?: string | undefined;
};

export type ChargingRequirement = "region" | "vehicle/connector" | "complete charger/kit";

const CHARGER = /\b(?:(?:ev|electric\s+vehicle|tesla)\s+(?:chargers?|charging\s+stations?)|tesla\s+wall\s+connector)\b|充电桩/iu;
const ACCESSORY = /\b(?:adapters?|cables?|replacement|accessor(?:y|ies)|mount(?:ing)?|holders?|brackets?)\b|转接|适配器|充电线|配件|支架/iu;
const UNRESOLVED = /\b(?:not|no|without|unknown|unsure|unconfirmed|undecided|exclude|excluding|cannot|can[' ]t|don[' ]t|doesn[' ]t|isn[' ]t|aren[' ]t)\b|不|没|未知|未确认|待定|待确认/iu;
const REGION = /\b(?:USA|United\s+States|UK|United\s+Kingdom|EU|Europe|Australia|Canada)\b|美国|英国|欧洲|澳大利亚|加拿大|中国/iu;
const CONNECTOR = /\b(?:NACS|J1772|CCS[12]?|CHAdeMO|type\s*[12]|model\s*[3syx]|ioniq|leaf|mustang|bolt)\b|国标/iu;
const CHARGER_FORMAT = /\b(?:complete\s+(?:(?:ev|tesla)\s+)?charger|fully\s+assembled|ready[- ]to[- ]install|kit|DIY)\b|整机|完整充电桩|套件|自行组装/iu;

/** User decision facts only. Product claims cannot fill these compatibility gaps. */
export function missingChargingRequirements(input: ChargingDecisionInput): ChargingRequirement[] {
  const target = `${input.query ?? ""} ${input.productType ?? ""}`;
  if (!CHARGER.test(target) || isSeparateAccessory(input.query ?? "", input.productType ?? "")) return [];

  // Do not turn a rejected option or an unresolved value into compatibility.
  // Clauses are kept separate so "not US, use in Canada" retains Canada.
  const clauses = [input.query, input.productType, input.primaryUse, input.requiredSize, input.preferredSize,
    ...input.requiredFeatures ?? [], ...input.preferences ?? []]
    .filter((value): value is string => value !== undefined)
    .flatMap(value => value.split(/[,;.!?\n，；。！？]|\bbut\b|但是|而是/iu));
  const confirmedClauses = (field: ChargingRequirement) => clauses.map(clause => {
    // Query normalization removes punctuation. Keep a named unknown connector
    // from erasing an explicit region/format, without allowing it to prove a connector.
    return field === "vehicle/connector" ? clause : clause.replace(/(?:接口|车辆型号|车型)(?:未知|未确认|待定|不确定)/gu, "");
  }).filter(clause => !UNRESOLVED.test(clause));

  const missing: ChargingRequirement[] = [];
  // Lowercase "us" is a pronoun, not an explicit country. A ZIP or brand is not a region.
  if (!confirmedClauses("region").some(clause => REGION.test(clause) || /\bUS\b/u.test(clause))) missing.push("region");
  if (!confirmedClauses("vehicle/connector").some(clause => CONNECTOR.test(clause))) missing.push("vehicle/connector");
  if (!confirmedClauses("complete charger/kit").some(clause => CHARGER_FORMAT.test(clause))) missing.push("complete charger/kit");
  return missing;
}

function isSeparateAccessory(query: string, productType: string): boolean {
  if (ACCESSORY.test(productType)) return true;
  const accessory = ACCESSORY.exec(query);
  if (!accessory) return false;
  const charger = CHARGER.exec(query);
  if (!charger) return true;
  if (accessory.index < charger.index) {
    return !/带[^，。;]*的$/u.test(query.slice(0, charger.index));
  }
  const between = query.slice(charger.index + charger[0].length, accessory.index);
  const after = query.slice(accessory.index + accessory[0].length);
  return !(/\b(?:with(?:out)?|including|excluding|no|not)\b|带|包含|不要|不含|排除/iu.test(between) || /^\s+included\b/iu.test(after));
}
