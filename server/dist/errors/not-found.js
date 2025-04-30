import { StatusCodes } from "http-status-codes";
import CustomAPIError from "./custom-api.js";
export default class NotFoundError extends CustomAPIError {
    constructor(message) {
        super(message, StatusCodes.NOT_FOUND);
    }
}
