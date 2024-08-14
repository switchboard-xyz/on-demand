const I128MAX = "170141183460469231731687303715884105727";

function splitFromTail(input_: string, places: number): [string, string] {
  const input = input_.padStart(18, "0");
  const splitIndex = input.length - places;
  if (splitIndex <= 0) {
    return ["", input]; // if the string is shorter than N characters, the first part is empty
  }
  const firstPart = input.slice(0, splitIndex);
  const lastCharacters = input.slice(splitIndex);
  return [firstPart, lastCharacters];
}

export class PullFeedValueEvent {
  constructor(public readonly raw: any) {}
  toRows(): Array<{ feed: string; oracle: string; value: string | null }> {
    const out: any[] = [];
    if (!Array.isArray(this.raw?.data?.feeds)) return out;

    for (const feedIdx in this.raw.data.feeds) {
      const feed = this.raw.data.feeds[feedIdx];
      for (const oracleIdx in this.raw.data.oracles) {
        const oracle = this.raw.data.oracles[oracleIdx];
        const value = this.raw.data.values[feedIdx][oracleIdx];
        const valueParts = splitFromTail(value.toString(), 18);
        if (value.toString() === I128MAX) {
          out.push({
            feed: feed.toString(),
            oracle: oracle.toString(),
            value: null,
          });
        } else {
          out.push({
            feed: feed.toString(),
            oracle: oracle.toString(),
            value: `${valueParts[0]}.${valueParts[1]}`,
          });
        }
      }
    }
    return out;
  }
}
