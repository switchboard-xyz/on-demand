function splitFromTail(input: string, places: number): [string, string] {
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
  toRows(): Array<{ feed: string; oracle: string; value: string }> {
    const out: any[] = [];
    for (const feedIdx in this.raw.data.feeds) {
      const feed = this.raw.data.feeds[feedIdx];
      for (const oracleIdx in this.raw.data.oracles) {
        const oracle = this.raw.data.oracles[oracleIdx];
        const value = this.raw.data.values[feedIdx][oracleIdx];
        const valueParts = splitFromTail(value.toString(), 18);
        out.push({
          feed: feed.toString(),
          oracle: oracle.toString(),
          value: `${valueParts[0]}.${valueParts[1]}`,
        });
      }
    }
    return out;
  }
}
