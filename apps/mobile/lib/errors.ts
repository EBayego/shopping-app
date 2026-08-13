type ErrorWithMessage = { message: string };

function hasMessage(value: unknown): value is ErrorWithMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

export function getErrorMessage(error: unknown): string {
  if (!hasMessage(error)) return "Ha ocurrido un error inesperado.";

  const message = error.message;
  if (message.includes("Invite code is invalid or expired")) {
    return "La invitación no es válida, ha caducado o ya se ha utilizado.";
  }
  if (message.includes("Only a group owner")) {
    return "Solo la persona propietaria del grupo puede crear invitaciones.";
  }
  if (message.toLowerCase().includes("manual linking is disabled")) {
    return "La vinculación de cuentas está desactivada en Supabase.";
  }
  if (message.includes("Network request failed") || message.includes("fetch")) {
    return "No se ha podido conectar. Comprueba la red e inténtalo de nuevo.";
  }
  if (
    message.includes("Cannot coerce the result to a single JSON object") ||
    message.includes("multiple (or no) rows returned")
  ) {
    return "El grupo se ha eliminado o ya no tienes acceso.";
  }
  return message;
}
