# Sincronización offline de listas

SQLite es la fuente inmediata de lectura/escritura de una lista ya cargada. El
esquema local separa `cached_groups`, `cached_lists`,
`cached_shopping_intents`, `cached_group_members`, `pending_operations` y
`sync_metadata`. Las sesiones y sus tokens continúan exclusivamente en
SecureStore; SQLite no contiene credenciales ni claves.

## Escritura y replay

Una edición actualiza la proyección de la lista y añade su `operation_id` a la
outbox dentro de la misma transacción exclusiva. Solo entonces se completa la
mutation local. El replay consume la outbox por su secuencia autoincremental.
Supabase conserva el ledger idempotente definitivo: repetir el mismo UUID con
el mismo payload devuelve el resultado anterior. La fila local se elimina solo
después de esa confirmación.

Las altas usan inicialmente `local:<operation_id>`. Cuando Supabase devuelve el
UUID real, SQLite cambia el ID y reescribe las operaciones posteriores que aún
apunten al ID local, todo en una transacción. Un fallo de red deja intacta la
operación actual, incluidos sus intentos y último error, por lo que otro arranque
continúa exactamente desde ella.

## Reconciliación y conflictos

Tras el replay se descarga un snapshot autoritativo. SQLite reemplaza la base
cacheada y vuelve a aplicar, en orden, las operaciones todavía pendientes. Así
un replay parcial o un refetch de Realtime no borra cambios locales sin enviar.

La estrategia de conflictos es determinista y no usa CRDT:

- Para un recurso que el servidor ya eliminó, **gana la eliminación del
  servidor**.
- La operación local imposible no se descarta: pasa a `conflict`, conservando
  UUID, tipo, payload, fecha, intentos y error para poder informar o resolverla.
- Errores de autorización o payload inválido también son conflictos permanentes.
- Errores de transporte son reintentables y detienen el replay para respetar el
  orden.

Realtime sigue activo mientras hay conexión y provoca un refetch reconciliado.
Después de estar offline no se intenta reproducir el historial de broadcasts:
se ejecuta `outbox -> backend -> snapshot/refetch`. Al volver la app a primer
plano se reanuda el refresco de Auth y se intenta la misma sincronización.
