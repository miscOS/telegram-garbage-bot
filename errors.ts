export default class AppError extends Error {

    constructor(
        public code: string,
        public message: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}