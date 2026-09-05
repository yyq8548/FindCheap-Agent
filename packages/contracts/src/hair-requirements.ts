/** Conservative hair classes, not a user-imposed minimum length. The 12–24 inch
 * middle range stays unknown unless a source explicitly names a length class.
 * Only hair-length fields count: lace dimensions and cap circumference do not. */
export function hairFeatureStatus(text: string, feature: string): "MATCHED" | "CONTRADICTED" | "UNKNOWN" | undefined {
  text = text.normalize("NFKC").toLowerCase();
  feature = feature.normalize("NFKC").toLowerCase().trim()
    .replaceAll("长发", "long hair").replaceAll("短发", "short hair")
    .replaceAll("直发", "straight hair").replaceAll("卷发", "curly hair");
  const requested = /^(?:long|short|straight|curly|wavy)(?:\s+(?:hair|wig|wigs))?$/u.exec(feature)?.[0]?.split(" ")[0];
  if (requested === undefined || !/\b(?:wig|wigs|hair)\b/u.test(text)) return undefined;
  const short = /\b(?:short(?:\s+(?:cut|curly|human|hair|wig))?|bob|pixie|finger\s+wave)\b/u.test(text);
  const long = /\blong[ -](?:straight|curly|wavy|hair|wig|wigs)\b/u.test(text);
  const straight = /\bstraight\b/u.test(text);
  const curly = /\b(?:curly|curls|curled|wavy|waves?|finger[ -]wave)\b/u.test(text);
  if (requested === "straight") return curly ? "CONTRADICTED" : straight ? "MATCHED" : "UNKNOWN";
  if (requested === "curly" || requested === "wavy") return straight ? "CONTRADICTED" : curly ? "MATCHED" : "UNKNOWN";
  const lengths = [...text.matchAll(/\b(?:hair\s+length|wig\s+length|length)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:inches?|["″”])/gu)]
    .map(match => Number(match[1])).filter(value => value > 0 && value <= 100);
  const shortLength = lengths.some(value => value <= 12);
  const longLength = lengths.some(value => value >= 24);
  if (requested === "long") return short || shortLength ? "CONTRADICTED" : long || longLength ? "MATCHED" : "UNKNOWN";
  return long || longLength ? "CONTRADICTED" : short || shortLength ? "MATCHED" : "UNKNOWN";
}
