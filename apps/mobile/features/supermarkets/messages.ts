const GENERIC_ACCURACY_WARNING =
  "Los precios y la disponibilidad dependen de la información facilitada por el supermercado y podrían no ser totalmente precisos o estar desactualizados.";

export function supermarketAccuracyWarning(code: string): string {
  if (code === "EROSKI") {
    return (
      "Eroski no permite resolver de forma fiable la tienda mediante el código postal. " +
      "Sus precios quizá no sean los más precisos para tu zona."
    );
  }
  return GENERIC_ACCURACY_WARNING;
}
