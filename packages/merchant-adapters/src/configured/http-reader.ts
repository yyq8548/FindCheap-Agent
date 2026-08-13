import {
  buildConfiguredUrl,
  ensureSuccessfulJson,
  fetchConfigured,
  parseMappedRecords,
  type ReaderDependencies,
  type ReaderNetworkConfig,
  type RecordFieldMapping,
  type SourceReader
} from "./feed-reader.js";

export type HttpReaderConfig = ReaderNetworkConfig & {
  recordsPath: string;
  fields: RecordFieldMapping;
};

/** Reads a configured public JSON endpoint. HTML is handled only by the JSON-LD reader. */
export function createHttpReader(
  config: HttpReaderConfig,
  dependencies: ReaderDependencies = {}
): SourceReader {
  const url = buildConfiguredUrl(config.host, config.resourcePath);

  return {
    async read() {
      const response = await fetchConfigured(url, config.allowedHosts, dependencies);
      ensureSuccessfulJson(response);
      return parseMappedRecords(await response.text(), config.recordsPath, config.fields);
    }
  };
}
