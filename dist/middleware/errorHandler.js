import logger from '@blue-relay-tools/utils/logger';
export function errorHandler(err, req, res, next) {
    logger.logError(err, {
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    let statusCode = 500;
    let message = 'Internal Server Error';
    if (err?.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation Error';
    }
    else if (err?.name === 'UnauthorizedError') {
        statusCode = 401;
        message = 'Unauthorized';
    }
    else if (err?.name === 'NotFoundError') {
        statusCode = 404;
        message = 'Not Found';
    }
    else if (err?.code === 'ENOENT') {
        statusCode = 404;
        message = 'File not found';
    }
    res.status(statusCode).json({ success: false, error: message, message: err?.message, ...(process.env.NODE_ENV === 'development' && { stack: err?.stack }) });
}
export function notFoundHandler(req, res) {
    res.status(404).json({ success: false, error: 'Not Found', message: `Route ${req.method} ${req.url} not found` });
}
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
//# sourceMappingURL=errorHandler.js.map