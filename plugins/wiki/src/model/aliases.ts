export function reverseAliases<K extends string>(
  dictionary: Record<K, string>,
): Readonly<Record<string, K>> {
  return Object.fromEntries(
    (Object.keys(dictionary) as K[]).map((key) => [dictionary[key], key]),
  );
}
