export function isValidGtin(value: string | undefined): boolean {
  if (
    value === undefined ||
    !/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(value)
  ) {
    return false;
  }
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;
  let sum = 0;
  for (
    let index = digits.length - 1, position = 0;
    index >= 0;
    index--, position++
  ) {
    sum += (digits[index] ?? 0) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}
