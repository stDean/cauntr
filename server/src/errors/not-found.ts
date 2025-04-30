import { StatusCodes } from "http-status-codes";
import CustomAPIError from "./custom-api";

export default class NotFoundError extends CustomAPIError {
  constructor(message: string) {
    super(message, StatusCodes.NOT_FOUND);
  }
}
