/** The typed errors `errorResponse` maps to a status; they live apart from api.ts so the persistence layer can throw them without importing the operations. */
export class NotFoundError extends Error {}
export class BadRequestError extends Error {}
/** No signed-in organizer stands behind the request. */
export class UnauthorizedError extends Error {}
/** The signed-in organizer does not own the event. */
export class ForbiddenError extends Error {}
