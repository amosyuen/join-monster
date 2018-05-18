const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Promise = require('bluebird')

module.exports = async function(db, name) {
  if (db === 'oracle') {
    assert(process.env.ORACLE_URL, 'Must provide environment variable ORACLE_URL, e.g. "pass@localhost/"')
    const [ password, connectString ] = process.env.ORACLE_URL.split('@')
    const knex = require('knex')({
      client: 'oracledb',
      connection: {
        user: name,
        password,
        connectString,
        stmtCacheSize: 0
      }
    })

    const schema = fs
      .readFileSync(path.join(__dirname, 'oracle.sql'))
      .toString()
      .split(/\r?\n\r?\n/)
      .map(stmt => stmt.trim())
    await runStatements(knex, schema)
    return knex
  }

  if (db === 'pg') {
    assert(process.env.PG_URL, 'Must provide environment variable PG_URL, e.g. "postgres://user:pass@localhost/"')
    const knex = require('knex')({
      client: 'pg',
      connection: process.env.PG_URL + name
    })
    const schema = fs
      .readFileSync(path.join(__dirname, 'pg.sql'))
      .toString()
      .split(/;/)
    await runStatements(knex, schema)
    return knex
  }

  if (db === 'mysql') {
    assert(process.env.MYSQL_URL, 'Must provide environment variable MYSQL_URL, e.g. "mysql://user:pass@localhost/"')
    const schema = fs
      .readFileSync(path.join(__dirname, 'mysql.sql'))
      .toString()
      .split(/;/)
    const knex = require('knex')({
      client: 'mysql',
      connection: process.env.MYSQL_URL + name
    })
    await runStatements(knex, schema)
    return knex
  }

  if (db === 'sqlite3') {
    const knex = require('knex')({
      client: 'sqlite3',
      connection: {
        filename: __dirname + `/../db/${name}-data.sl3`
      },
      useNullAsDefault: true
    })
    const schema = fs
      .readFileSync(path.join(__dirname, 'sqlite3.sql'))
      .toString()
      .split(/;/)
    await runStatements(knex, schema)
    return knex
  }

  throw new Error(`do not recognize database "${db}"`)
}

async function runStatements(knex, statements) {
  try {
    await Promise.mapSeries(statements.map(stmt => stmt.trim()).filter(stmt => stmt), stmt => {
      console.log(stmt)
      return knex.raw(stmt)
    })
    return knex
  } catch (err) {
    console.error(err)
    knex.destroy()
    process.exit(1)
  }
}
