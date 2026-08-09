let online = true;

export function setNetworkOnline(value: boolean): void {
  online = value;
}

export function isNetworkOnline(): boolean {
  return online;
}
