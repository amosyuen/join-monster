import { interpretForOffsetPaging, interpretForKeysetPaging, orderColumnsToString } from '../shared'
import { filter } from 'lodash'

function recursiveConcat(keys) {
  if (keys.length <= 1) {
    return keys[0]
  }
  return recursiveConcat([ `CONCAT(${keys[0]}, ${keys[1]})`, ...keys.slice(2) ])
}

const q = str => `"${str}"`

function keysetPagingSelect(expressions, table, whereCondition, order, limit, as, options = {}) {
  let { joinCondition, joinType, extraJoin } = options
  const selections = [ `${q(as)}.*`, ...new Set(expressions.map(expr => `${expr.expr} AS ${q(expr.as)}`)) ].join(',\n  ')
  whereCondition = filter(whereCondition).join(' AND ') || '1 = 1'
  order = orderColumnsToString(order, q)
  if (joinCondition) {
    return `\
${ joinType === 'LEFT' ? 'OUTER' : 'CROSS' } APPLY (
  SELECT ${selections}
  FROM ${table} ${q(as)}
  ${
  extraJoin
    ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}`
    : ''
}
  WHERE ${whereCondition}
  ORDER BY ${order}
  FETCH FIRST ${limit} ROWS ONLY
) ${q(as)}`
  }
  return `\
FROM (
  SELECT ${selections}
  FROM ${table} ${q(as)}
  WHERE ${whereCondition}
  ORDER BY ${order}
  FETCH FIRST ${limit} ROWS ONLY
) ${q(as)}`
}

function offsetPagingSelect(expressions, table, pagingWhereConditions, order, limit, offset, as, options = {}) {
  let { joinCondition, joinType, extraJoin } = options
  const selections = [
    `${q(as)}.*`,
    ...new Set(expressions.map(expr => `${expr.expr} AS ${q(expr.as)}`)),
    `count(*) OVER () AS ${q('$total')}`
  ].join(',\n  ')
  const whereCondition = filter(pagingWhereConditions).join(' AND ') || '1 = 1'
  order = orderColumnsToString(order, q)
  if (joinCondition) {
    return `\
${joinType === 'LEFT' ? 'OUTER' : 'CROSS'} APPLY (
  SELECT ${selections}
  FROM ${table} "${as}"
  ${extraJoin ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}` : ''}
  WHERE ${whereCondition}
  ORDER BY ${order}
  OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
) ${q(as)}`
  }
  return `\
FROM (
  SELECT ${selections}
  FROM ${table} "${as}"
  WHERE ${whereCondition}
  ORDER BY ${order}
  OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
) ${q(as)}`
}

const dialect = module.exports = {
  ...require('./pg'),
  name: 'oracle',

  compositeKey(parent, keys) {
    keys = keys.map(key => `"${parent}"."${key}"`)
    return `NULLIF(${recursiveConcat(keys)}, '')`
  },

  handlePaginationAtRoot: async function(parent, node, context, expressions, tables) {
    const pagingWhereConditions = []
    if (node.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect, expressions)
      pagingWhereConditions.push(whereAddendum)
      if (node.where) {
        pagingWhereConditions.push(await node.where(`"${node.as}"`, node.args || {}, context, node))
      }
      tables.push(keysetPagingSelect(expressions, node.name, pagingWhereConditions, order, limit, node.as))
    } else if (node.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect)
      if (node.where) {
        pagingWhereConditions.push(await node.where(`"${node.as}"`, node.args || {}, context, node))
      }
      tables.push(offsetPagingSelect(expressions, node.name, pagingWhereConditions, order, limit, offset, node.as))
    }
  },

  handleJoinedOneToManyPaginated: async function(parent, node, context, expressions, tables, joinCondition) {
    const pagingWhereConditions = [ await node.sqlJoin(`"${parent.as}"`, q(node.as), node.args || {}, context, node) ]
    if (node.where) {
      pagingWhereConditions.push(await node.where(`"${node.as}"`, node.args || {}, context, node))
    }

    // which type of pagination are they using?
    if (node.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect, expressions)
      pagingWhereConditions.push(whereAddendum)
      tables.push(
        keysetPagingSelect(expressions, node.name, pagingWhereConditions, order, limit, node.as, {
          joinCondition,
          joinType: 'LEFT'
        })
      )
    } else if (node.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect)
      tables.push(
        offsetPagingSelect(expressions, node.name, pagingWhereConditions, order, limit, offset, node.as, {
          joinCondition,
          joinType: 'LEFT'
        })
      )
    }
  },

  handleJoinedManyToManyPaginated: async function(
    parent,
    node,
    context,
    expressions,
    tables,
    joinCondition1,
    joinCondition2
  ) {
    const pagingWhereConditions = [
      await node.junction.sqlJoins[0](`"${parent.as}"`, `"${node.junction.as}"`, node.args || {}, context, node)
    ]
    if (node.junction.where) {
      pagingWhereConditions.push(
        await node.junction.where(`"${node.junction.as}"`, node.args || {}, context, node)
      )
    }
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`"${node.as}"`, node.args || {}, context, node)
      )
    }

    const lateralJoinOptions = { joinCondition: joinCondition1, joinType: 'LEFT' }
    if (node.where || node.orderBy) {
      lateralJoinOptions.extraJoin = {
        name: node.name,
        as: node.as,
        condition: joinCondition2
      }
    }
    if (node.sortKey || node.junction.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect, expressions)
      pagingWhereConditions.push(whereAddendum)
      tables.push(
        keysetPagingSelect(
          expressions,
          node.junction.sqlTable,
          pagingWhereConditions,
          order,
          limit,
          node.junction.as,
          lateralJoinOptions
        )
      )
    } else if (node.orderBy || node.junction.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect, expressions)
      tables.push(
        offsetPagingSelect(
          expressions,
          node.junction.sqlTable,
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.junction.as,
          lateralJoinOptions
        )
      )
    }
  },

  handleBatchedOneToManyPaginated: async function(parent, node, context, expressions, tables, batchScope) {
    const pagingWhereConditions = [ `"${node.as}"."${node.sqlBatch.thisKey.name}" = "temp"."value"` ]
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`"${node.as}"`, node.args || {}, context, node)
      )
    }
    tables.push(`FROM (${arrToTableUnion(batchScope)}) "temp"`)
    const lateralJoinCondition = `"${node.as}"."${node.sqlBatch.thisKey.name}" = "temp"."value"`
    if (node.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect, expressions)
      pagingWhereConditions.push(whereAddendum)
      tables.push(
        keysetPagingSelect(expressions, node.name, pagingWhereConditions, order, limit, node.as, {
          joinCondition: lateralJoinCondition
        })
      )
    } else if (node.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect, expressions)
      tables.push(
        offsetPagingSelect(expressions, node.name, pagingWhereConditions, order, limit, offset, node.as, {
          joinCondition: lateralJoinCondition
        })
      )
    }
  },

  handleBatchedManyToManyPaginated: async function(parent, node, context, expressions, tables, batchScope, joinCondition) {
    const pagingWhereConditions = [ `"${node.junction.as}"."${node.junction.sqlBatch.thisKey.name}" = "temp"."value"` ]
    if (node.junction.where) {
      pagingWhereConditions.push(
        await node.junction.where(`"${node.junction.as}"`, node.args || {}, context, node)
      )
    }
    if (node.where) {
      pagingWhereConditions.push(await node.where(`"${node.as}"`, node.args || {}, context, node))
    }

    tables.push(`FROM (${arrToTableUnion(batchScope)}) "temp"`)
    const lateralJoinCondition = `"${node.junction.as}"."${node.junction.sqlBatch.thisKey.name}" = "temp"."value"`

    const lateralJoinOptions = { joinCondition: lateralJoinCondition, joinType: 'LEFT' }
    if (node.where || node.orderBy) {
      lateralJoinOptions.extraJoin = {
        name: node.name,
        as: node.as,
        condition: joinCondition
      }
    }
    if (node.sortKey || node.junction.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect, expressions)
      pagingWhereConditions.push(whereAddendum)
      tables.push(
        keysetPagingSelect(
          expressions,
          node.junction.sqlTable,
          pagingWhereConditions,
          order,
          limit,
          node.junction.as,
          lateralJoinOptions
        )
      )
    } else if (node.orderBy || node.junction.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect, expressions)
      tables.push(
        offsetPagingSelect(
          expressions,
          node.junction.sqlTable,
          pagingWhereConditions,
          order,
          limit,
          offset,
          node.junction.as,
          lateralJoinOptions
        )
      )
    }
    tables.push(`LEFT JOIN ${node.name} "${node.as}" ON ${joinCondition}`)
  }
}


function arrToTableUnion(arr) {
  return arr.map(val => `
  SELECT ${val} AS "value" FROM DUAL
`).join(' UNION ')
}
