class ApiResponse {
  static send(res, { statusCode = 200, status = 1, message = 'Success', data = null, metadata = [] }) {
    return res.status(statusCode).json({
      statusCode,
      status,
      message,
      data: data !== null && data !== undefined ? data : (status === 1 ? {} : []),
      metadata,
    })
  }

  static success(res, data = {}, message = 'Success', metadata = []) {
    return ApiResponse.send(res, { statusCode: 200, status: 1, message, data, metadata })
  }

  static created(res, data = {}, message = 'Created', metadata = []) {
    return ApiResponse.send(res, { statusCode: 201, status: 1, message, data, metadata })
  }

  static error(res, message = 'Something went wrong', statusCode = 500, metadata = []) {
    return ApiResponse.send(res, { statusCode, status: 0, message, data: [], metadata })
  }
}

module.exports = ApiResponse
