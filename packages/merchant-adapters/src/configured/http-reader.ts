import {
  buildConfiguredUrl,
  ensureSuccessfulJson,
  fetchConfigured,
  parseMappedRecords,
  sourceReadSnapshot,
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

  const capture = async () => {
    const fetched = await fetchConfigured(url, config.allowedHosts, dependencies);
    const { response } = fetched;
    ensureSuccessfulJson(response);
    const rawBody = await response.text();
    return sourceReadSnapshot(
      parseMappedRecords(rawBody, config.recordsPath, config.fields),
      rawBody,
      fetched.finalUrl,
      dependencies
    );
  };
  return { capture, read: async () => (await capture()).records };
}
