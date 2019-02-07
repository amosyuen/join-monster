'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.joinPrefix = joinPrefix;
exports.generateCastExpressionFromValueType = generateCastExpressionFromValueType;
exports.thisIsNotTheEndOfThisBatch = thisIsNotTheEndOfThisBatch;
exports.whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch = whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch;
exports.keysetPagingSelect = keysetPagingSelect;
exports.offsetPagingSelect = offsetPagingSelect;
exports.orderColumnsToString = orderColumnsToString;
exports.interpretForOffsetPaging = interpretForOffsetPaging;
exports.interpretForKeysetPaging = interpretForKeysetPaging;
exports.addToOrder = addToOrder;
exports.validateCursor = validateCursor;

var _lodash = require('lodash');

var _graphqlRelay = require('graphql-relay');

var _util = require('../util');

function joinPrefix(prefix) {
  return prefix.slice(1).map(name => name + '__').join('');
}

function generateCastExpressionFromValueType(key, val) {
  const castTypes = {
    string: 'TEXT'
  };
  const type = castTypes[typeof val] || null;

  if (type) {
    return `CAST(${key} AS ${type})`;
  }
  return key;
}

function doubleQuote(str) {
  return `"${str}"`;
}

function thisIsNotTheEndOfThisBatch(node, parent) {
  var _ref7;

  return !node.sqlBatch && !((_ref7 = node) != null ? (_ref7 = _ref7.junction) != null ? _ref7.sqlBatch : _ref7 : _ref7) || !parent;
}

function whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch(node, parent) {
  var _ref6;

  return !node.paginate && (!(node.sqlBatch || ((_ref6 = node) != null ? (_ref6 = _ref6.junction) != null ? _ref6.sqlBatch : _ref6 : _ref6)) || !parent);
}

function keysetPagingSelect(expressions, table, whereCondition, order, limit, as, options = {}) {
  let { joinCondition, joinType, extraJoin, q } = options;
  q = q || doubleQuote;
  const selections = [`${q(as)}.*`, ...new Set(expressions.map(expr => `${expr.expr} AS ${q(expr.as)}`))].join(',\n  ');
  whereCondition = (0, _lodash.filter)(whereCondition).join(' AND ') || 'TRUE';
  order = orderColumnsToString(order, q);
  if (joinCondition) {
    return `\
${joinType || ''} JOIN LATERAL (
  SELECT ${selections}
  FROM ${table} ${q(as)}
  ${extraJoin ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}` : ''}
  WHERE ${whereCondition}
  ORDER BY ${order}
  LIMIT ${limit}
) ${q(as)} ON ${joinCondition}`;
  }
  return `\
FROM (
  SELECT ${selections}
  FROM ${table} ${q(as)}
  WHERE ${whereCondition}
  ORDER BY ${order}
  LIMIT ${limit}
) ${q(as)}`;
}

function offsetPagingSelect(expressions, table, pagingWhereConditions, order, limit, offset, as, options = {}) {
  let { joinCondition, joinType, extraJoin, q } = options;
  q = q || doubleQuote;
  const selections = [`${q(as)}.*`, ...new Set(expressions.map(expr => `${expr.expr} AS ${q(expr.as)}`)), `count(*) OVER () AS ${q('$total')}`].join(',\n  ');
  const whereCondition = (0, _lodash.filter)(pagingWhereConditions).join(' AND ') || 'TRUE';
  order = orderColumnsToString(order, q);
  if (joinCondition) {
    return `\
${joinType || ''} JOIN LATERAL (
  SELECT ${selections}
  FROM ${table} ${q(as)}
  ${extraJoin ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}` : ''}
  WHERE ${whereCondition}
  ORDER BY ${order}
  LIMIT ${limit} OFFSET ${offset}
) ${q(as)} ON ${joinCondition}`;
  }
  return `\
FROM (
  SELECT ${selections}
  FROM ${table} ${q(as)}
  WHERE ${whereCondition}
  ORDER BY ${order}
  LIMIT ${limit} OFFSET ${offset}
) ${q(as)}`;
}

function orderColumnsToString(order, q) {
  return order.map(entry => `${entry.table ? `${q(entry.table)}.` : ''}${q(entry.column)} ${entry.direction}`).join(', ');
}

function interpretForOffsetPaging(node, dialect, expressions) {
  var _ref4, _ref5;

  const { name } = dialect;
  if ((_ref5 = node) != null ? (_ref5 = _ref5.args) != null ? _ref5.last : _ref5 : _ref5) {
    throw new Error('Backward pagination not supported with offsets. Consider using keyset pagination instead');
  }

  let sortTable;
  let orderBy;
  if (node.orderBy) {
    sortTable = node.as;
    orderBy = node.orderBy;
  } else {
    sortTable = node.junction.as;
    orderBy = node.junction.orderBy;
  }
  const order = [];
  for (let column in orderBy) {
    const direction = orderBy[column];
    addToOrder(order, column, direction, sortTable, expressions, true);
  }

  let limit = ['mariadb', 'mysql', 'oracle'].includes(name) ? '18446744073709551615' : 'ALL';
  let offset = 0;
  if ((_ref4 = node) != null ? (_ref4 = _ref4.args) != null ? _ref4.first : _ref4 : _ref4) {
    limit = parseInt(node.args.first, 10);

    if (node.paginate) {
      limit++;
    }
    if (node.args.after) {
      offset = (0, _graphqlRelay.cursorToOffset)(node.args.after) + 1;
    }
  }
  return { limit, offset, order };
}

function interpretForKeysetPaging(node, dialect, expressions) {
  var _ref, _ref2, _ref3;

  const { name } = dialect;

  let sortTable;
  let sortKey;
  if (node.sortKey) {
    sortTable = node.as;
    sortKey = node.sortKey;
  } else {
    sortTable = node.junction.as;
    sortKey = node.junction.sortKey;
  }
  let descending = sortKey.order.toUpperCase() === 'DESC';

  if ((_ref3 = node) != null ? (_ref3 = _ref3.args) != null ? _ref3.last : _ref3 : _ref3) {
    descending = !descending;
  }
  const order = [];
  for (let column of (0, _util.wrap)(sortKey.key)) {
    const direction = descending ? 'DESC' : 'ASC';
    addToOrder(order, column, direction, sortTable, expressions, true);
  }

  let limit = ['mariadb', 'mysql', 'oracle'].includes(name) ? '18446744073709551615' : 'ALL';
  let whereCondition = '';
  if ((_ref2 = node) != null ? (_ref2 = _ref2.args) != null ? _ref2.first : _ref2 : _ref2) {
    limit = parseInt(node.args.first, 10) + 1;
    if (node.args.after) {
      const cursorObj = (0, _util.cursorToObj)(node.args.after);
      validateCursor(cursorObj, (0, _util.wrap)(sortKey.key));
      whereCondition = sortKeyToWhereCondition(cursorObj, descending, sortTable, dialect);
    }
    if (node.args.before) {
      throw new Error('Using "before" with "first" is nonsensical.');
    }
  } else if ((_ref = node) != null ? (_ref = _ref.args) != null ? _ref.last : _ref : _ref) {
    limit = parseInt(node.args.last, 10) + 1;
    if (node.args.before) {
      const cursorObj = (0, _util.cursorToObj)(node.args.before);
      validateCursor(cursorObj, (0, _util.wrap)(sortKey.key));
      whereCondition = sortKeyToWhereCondition(cursorObj, descending, sortTable, dialect);
    }
    if (node.args.after) {
      throw new Error('Using "after" with "last" is nonsensical.');
    }
  }

  return { limit, order, whereCondition };
}

function addToOrder(order, column, direction, as, expressions, stripTable) {
  let table = as;
  for (const expr of expressions) {
    if (expr.column === column) {
      column = expr.as;
      if (stripTable) {
        table = undefined;
      }
      break;
    }
  }
  order.push({ table, column, direction });
}

function validateCursor(cursorObj, expectedKeys) {
  const actualKeys = Object.keys(cursorObj);
  const expectedKeySet = new Set(expectedKeys);
  const actualKeySet = new Set(actualKeys);
  for (let key of actualKeys) {
    if (!expectedKeySet.has(key)) {
      throw new Error(`Invalid cursor. The column "${key}" is not in the sort key.`);
    }
  }
  for (let key of expectedKeys) {
    if (!actualKeySet.has(key)) {
      throw new Error(`Invalid cursor. The column "${key}" is not in the cursor.`);
    }
  }
}

function sortKeyToWhereCondition(keyObj, descending, sortTable, dialect) {
  const { name, quote: q } = dialect;
  const sortColumns = [];
  const sortValues = [];
  for (let key in keyObj) {
    sortColumns.push(`${q(sortTable)}.${q(key)}`);
    sortValues.push((0, _util.maybeQuote)(keyObj[key], name));
  }
  const operator = descending ? '<' : '>';
  return name === 'oracle' ? recursiveWhereJoin(sortColumns, sortValues, operator) : `(${sortColumns.join(', ')}) ${operator} (${sortValues.join(', ')})`;
}

function recursiveWhereJoin(columns, values, op) {
  const condition = `${columns.pop()} ${op} ${values.pop()}`;
  return _recursiveWhereJoin(columns, values, op, condition);
}

function _recursiveWhereJoin(columns, values, op, condition) {
  if (!columns.length) {
    return condition;
  }
  const column = columns.pop();
  const value = values.pop();
  condition = `(${column} ${op} ${value} OR (${column} = ${value} AND ${condition}))`;
  return _recursiveWhereJoin(columns, values, op, condition);
}