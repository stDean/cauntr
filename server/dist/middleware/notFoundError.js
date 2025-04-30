import { StatusCodes } from "http-status-codes";
export const notFound = (req, res, next) => {
    res.status(StatusCodes.NOT_FOUND).send("Route does not exist");
    next();
};
