const http = require('http')
const cors = require('cors')
const express = require('express')
const prettyMs = require('pretty-ms')
const onFinished = require('on-finished')
const expressBodyParser = require('body-parser')
const expressRest = require('express-rest-api')

const config = require('../config')
const authorization = require('./authorization')

const rootRouter = require('../route/root')
const authRouter = require('../route/auth')
const userRouter = require('../route/user')
const roleRouter = require('../route/role')
const statsRouter = require('../route/stats')
const personRouter = require('../route/person')
const permissionRouter = require('../route/permission')
const notificationRouter = require('../route/notification')
const organizationRouter = require('../route/organization')
const personRequestRouter = require('../route/person-request')
const contributorRouter = require('../route/contributor')

class Server {
  constructor (config, logger, database, auth0, aws) {
    this.config = config
    this.logger = logger.child({ context: 'Server' })
    this.database = database
    this.auth0 = auth0
    this.aws = aws

    this.logger.verbose('Creating express app')
    this.expressApp = express()
    this.logger.verbose('Express app created')

    this._setupServer()
    this._setupExpressMiddleware()
    this._setupExpressRoutes()
    this._setupErrorHandler()
  }

  listen (cb) {
    this.logger.verbose('Attempting to bind HTTP server')
    this._httpServer.listen(this.config.server.port, (err) => {
      if (err) { return cb(err) }
      this.logger.verbose('HTTP server bound')
      cb(null)
    })
  }

  close (cb) {
    this._httpServer.close(cb)
  }

  _setupServer () {
    this.logger.verbose('Creating HTTP server instance')
    this._httpServer = http.createServer(this.expressApp)
    this.logger.verbose('HTTP server instance created')
  }

  _setupExpressMiddleware () {
    this.expressApp.request.config = this.config
    this.expressApp.request.auth0 = this.auth0
    this.expressApp.request.aws = this.aws
    this.expressApp.request.model = (...args) => this.database.model(...args)
    this.expressApp.request.pingDatabase = (...args) => this.database.ping(...args)

    const createReqLogger = (req, res, next) => {
      req._startTime = Date.now()
      req.logger = this.logger.child(
        req.headers['x-request-id'] ? { requestId: req.headers['x-request-id'] } : {}
      )

      req.logger.info('Incoming request', {
        httpVersion: req.httpVersion,
        method: req.method,
        url: req.url,
        headers: req.headers,
        trailers: req.trailers
      })

      onFinished(res, () => {
        req.logger.info('Outgoing response', {
          httpVersion: req.httpVersion,
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration: prettyMs(Date.now() - req._startTime)
        })
      })

      next(null)
    }

    this.logger.verbose('Attaching middleware to express app')
    this.expressApp.use(createReqLogger)
    this.expressApp.use(cors(this.config.cors))
    this.expressApp.use(expressBodyParser.raw({ limit: '5mb' }))
    this.expressApp.use(expressBodyParser.json({ limit: '5mb' }))
    this.expressApp.use(expressRest({
      resourceId: '_id',
      maxResultsLimit: config.server.maxResultsLimit
    }))
    this.logger.verbose('Middleware attached')
  }

  _setupExpressRoutes () {
    this.logger.verbose('Attaching resource routers to express app')
    this.expressApp.use('/', rootRouter)
    this.expressApp.use('/auth', authRouter)
    this.expressApp.use('/stats', authorization, statsRouter)
    this.expressApp.use('/person', personRouter)
    this.expressApp.use('/notification', notificationRouter)
    this.expressApp.use('/person-request', personRequestRouter)
    this.expressApp.use('/contributor', contributorRouter)
    this.expressApp.use('/user', authorization, userRouter)
    this.expressApp.use('/role', authorization, roleRouter)
    this.expressApp.use('/permission', authorization, permissionRouter)
    this.expressApp.use('/organization', authorization, organizationRouter)
    this.logger.verbose('Resource routers attached')
  }

  _setupErrorHandler () {
    this.logger.verbose('Attaching error handler')
    this.expressApp.use((err, req, res, next) => {
      if (err && err.name === 'UnauthorizedError') {
        return res.status(401).send(err.message)
      }
      err.statusCode || (err.statusCode = Server.statusCodeByErrorName[err.name] || 500)
      req.logger.error(err.toString(), err)
      req.logger.verbose('Responding to client', err.toString())
      res.status(err.statusCode).send(err.toString())
    })
    this.logger.verbose('Error handler attached')
  }
}

Server.statusCodeByErrorName = {
  ValidationError: 400,
  CastError: 400
}

module.exports = Server
