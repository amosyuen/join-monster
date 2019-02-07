'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

let _stringifySqlASTExpression = (() => {
  var _ref7 = _asyncToGenerator(function* (parent, node, prefix, context, expressions, dialect) {
    const sourceTable = node.fromOtherTable || parent && parent.as;

    const table = parent && parent.junction ? parent.junction.as : sourceTable;
    const { quote: q } = dialect;
    const expr = yield node.sqlExpr(`${q(sourceTable)}`, node.args || {}, context, node);
    expressions.push({
      table,
      expr,
      column: node.fieldName,
      as: (0, _shared.joinPrefix)(prefix) + node.as
    });
  });

  return function _stringifySqlASTExpression(_x4, _x5, _x6, _x7, _x8, _x9) {
    return _ref7.apply(this, arguments);
  };
})();

let _stringifySqlASTExpressions = (() => {
  var _ref8 = _asyncToGenerator(function* (parent, expressionNodes, prefix, context, expressions, dialect) {
    const requestedFieldAs = new Set();
    const generatedFields = [];
    for (let child of expressionNodes) {
      if (child.isGeneratedSortColumn) {
        generatedFields.push(child);
      } else {
        yield _stringifySqlASTExpression(parent, child, prefix, context, expressions, dialect);
        requestedFieldAs.add(child.as);
      }
    }
    for (let child of generatedFields) {
      if (!requestedFieldAs.has(child.as)) {
        yield _stringifySqlASTExpression(parent, child, prefix, context, expressions, dialect);
        requestedFieldAs.add(child.as);
      }
    }
  });

  return function _stringifySqlASTExpressions(_x10, _x11, _x12, _x13, _x14, _x15) {
    return _ref8.apply(this, arguments);
  };
})();

let _stringifySqlAST = (() => {
  var _ref9 = _asyncToGenerator(function* (parent, node, prefix, context, selections, tables, wheres, order, batchScope, dialect) {
    const { quote: q } = dialect;
    const parentTable = node.fromOtherTable || parent && parent.as;
    let expressionNodes;
    let expressions;
    switch (node.type) {
      case 'table':
        expressions = [];
        if ((0, _shared.thisIsNotTheEndOfThisBatch)(node, parent)) {
          expressionNodes = [];
          for (let child of node.children) {
            if (child.type === 'expression') {
              expressionNodes.push(child);
            }
          }
          yield _stringifySqlASTExpressions(node, expressionNodes, [...prefix, node.as], context, expressions, dialect);
        }

        yield handleTable(parent, node, prefix, context, selections, expressions, tables, wheres, order, batchScope, dialect);

        if ((0, _shared.thisIsNotTheEndOfThisBatch)(node, parent)) {
          for (let child of node.children) {
            yield _stringifySqlAST(node, child, [...prefix, node.as], context, selections, tables, wheres, order, null, dialect);
          }
        }
        break;
      case 'union':
        expressions = [];
        if ((0, _shared.thisIsNotTheEndOfThisBatch)(node, parent)) {
          expressionNodes = [];
          for (let typeName in node.typedChildren) {
            for (let child of node.typedChildren[typeName]) {
              if (child.type === 'expression') {
                expressionNodes.push(child);
              }
            }
          }
          for (let child of node.children) {
            if (child.type === 'expression') {
              expressionNodes.push(child);
            }
          }
          yield _stringifySqlASTExpressions(node, expressionNodes, [...prefix, node.as], context, expressions, dialect);
        }

        yield handleTable(parent, node, prefix, context, selections, expressions, tables, wheres, order, batchScope, dialect);

        if ((0, _shared.thisIsNotTheEndOfThisBatch)(node, parent)) {
          for (let typeName in node.typedChildren) {
            for (let child of node.typedChildren[typeName]) {
              yield _stringifySqlAST(node, child, [...prefix, node.as], context, selections, tables, wheres, order, null, dialect);
            }
          }
          for (let child of node.children) {
            yield _stringifySqlAST(node, child, [...prefix, node.as], context, selections, tables, wheres, order, null, dialect);
          }
        }
        for (let child of node.children) {
          yield _stringifySqlAST(node, child, [...prefix, node.as], context, selections, tables, wheres, order, null, dialect);
        }
        break;
      case 'column':
        selections.add(`${q(parentTable)}.${q(node.name)} AS ${q((0, _shared.joinPrefix)(prefix) + node.as)}`);
        break;
      case 'columnDeps':
        for (let name in node.names) {
          selections.add(`${q(parentTable)}.${q(name)} AS ${q((0, _shared.joinPrefix)(prefix) + node.names[name])}`);
        }
        break;
      case 'composite':
        selections.add(`${dialect.compositeKey(parentTable, node.name)} AS ${q((0, _shared.joinPrefix)(prefix) + node.as)}`);
        break;
      case 'expression':
        break;
      case 'noop':
        return;
      default:
        throw new Error('unexpected/unknown node type reached: ' + (0, _util.inspect)(node));
    }
    return { selections, tables, wheres, order };
  });

  return function _stringifySqlAST(_x16, _x17, _x18, _x19, _x20, _x21, _x22, _x23, _x24, _x25) {
    return _ref9.apply(this, arguments);
  };
})();

let handleTable = (() => {
  var _ref10 = _asyncToGenerator(function* (parent, node, prefix, context, selections, expressions, tables, wheres, order, batchScope, dialect) {
    var _ref3, _ref4;

    let usedNestedQuery = false;
    const { quote: q } = dialect;

    if ((0, _shared.whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch)(node, parent)) {
      var _ref5;

      if ((_ref5 = node) != null ? (_ref5 = _ref5.junction) != null ? _ref5.where : _ref5 : _ref5) {
        wheres.push((yield node.junction.where(`${q(node.junction.as)}`, node.args || {}, context, node)));
      }
      if (node.where) {
        wheres.push((yield node.where(`${q(node.as)}`, node.args || {}, context, node)));
      }
    }

    if (node.sqlJoin) {
      const joinCondition = yield node.sqlJoin(`${q(parent.as)}`, q(node.as), node.args || {}, context, node);

      if (node.paginate) {
        yield dialect.handleJoinedOneToManyPaginated(parent, node, context, expressions, tables, joinCondition);
        usedNestedQuery = true;
      } else if (node.limit) {
        node.args.first = node.limit;
        yield dialect.handleJoinedOneToManyPaginated(parent, node, context, expressions, tables, joinCondition);
        usedNestedQuery = true;
      } else {
        tables.push(`LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`);
      }
    } else if ((_ref4 = node) != null ? (_ref4 = _ref4.junction) != null ? _ref4.sqlBatch : _ref4 : _ref4) {
      if (parent) {
        selections.add(`${q(parent.as)}.${q(node.junction.sqlBatch.parentKey.name)} AS ${q((0, _shared.joinPrefix)(prefix) + node.junction.sqlBatch.parentKey.as)}`);
      } else {
        const joinCondition = yield node.junction.sqlBatch.sqlJoin(`${q(node.junction.as)}`, q(node.as), node.args || {}, context, node);
        if (node.paginate) {
          yield dialect.handleBatchedManyToManyPaginated(parent, node, context, expressions, tables, batchScope, joinCondition);
        } else if (node.limit) {
          node.args.first = node.limit;
          yield dialect.handleBatchedManyToManyPaginated(parent, node, context, expressions, tables, batchScope, joinCondition);
        } else {
          tables.push(`FROM ${node.junction.sqlTable} ${q(node.junction.as)}`, `LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`);

          wheres.push(`${q(node.junction.as)}.${q(node.junction.sqlBatch.thisKey.name)} IN (${batchScope.join(',')})`);
        }
      }
    } else if ((_ref3 = node) != null ? (_ref3 = _ref3.junction) != null ? _ref3.sqlTable : _ref3 : _ref3) {
      const joinCondition1 = yield node.junction.sqlJoins[0](`${q(parent.as)}`, q(node.junction.as), node.args || {}, context, node);
      const joinCondition2 = yield node.junction.sqlJoins[1](`${q(node.junction.as)}`, q(node.as), node.args || {}, context, node);

      if (node.paginate) {
        yield dialect.handleJoinedManyToManyPaginated(parent, node, context, expressions, tables, joinCondition1, joinCondition2);
        usedNestedQuery = true;
      } else if (node.limit) {
        node.args.first = node.limit;
        yield dialect.handleJoinedManyToManyPaginated(parent, node, context, expressions, tables, joinCondition1, joinCondition2);
        usedNestedQuery = true;
      } else {
        tables.push(`LEFT JOIN ${node.junction.sqlTable} ${q(node.junction.as)} ON ${joinCondition1}`);
      }
      tables.push(`LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition2}`);
    } else if (node.sqlBatch) {
      if (parent) {
        selections.add(`${q(parent.as)}.${q(node.sqlBatch.parentKey.name)} AS ${q((0, _shared.joinPrefix)(prefix) + node.sqlBatch.parentKey.as)}`);
      } else if (node.paginate) {
        yield dialect.handleBatchedOneToManyPaginated(parent, node, context, expressions, tables, batchScope);
        usedNestedQuery = true;
      } else if (node.limit) {
        node.args.first = node.limit;
        yield dialect.handleBatchedOneToManyPaginated(parent, node, context, expressions, tables, batchScope);
        usedNestedQuery = true;
      } else {
        tables.push(`FROM ${node.name} ${q(node.as)}`);
        wheres.push(`${q(node.as)}.${q(node.sqlBatch.thisKey.name)} IN (${batchScope.join(',')})`);
      }
    } else if (node.paginate) {
      yield dialect.handlePaginationAtRoot(parent, node, context, expressions, tables);
      usedNestedQuery = true;
    } else if (node.limit) {
      node.args.first = node.limit;
      yield dialect.handlePaginationAtRoot(parent, node, context, expressions, tables);
      usedNestedQuery = true;
    } else {
      (0, _assert2.default)(!parent, `Object type for "${node.fieldName}" table must have a "sqlJoin" or "sqlBatch"`);
      tables.push(`FROM ${node.name} ${q(node.as)}`);
    }

    if (usedNestedQuery) {
      expressions.forEach(function (expr) {
        return selections.add(`${expr.table}.${expr.as} AS ${expr.as}`);
      });
    } else {
      expressions.forEach(function (expr) {
        return selections.add(`${expr.expr} AS ${expr.as}`);
      });
    }

    if ((0, _shared.thisIsNotTheEndOfThisBatch)(node, parent)) {
      var _ref, _ref2;

      if ((_ref2 = node) != null ? (_ref2 = _ref2.junction) != null ? _ref2.orderBy : _ref2 : _ref2) {
        addOrderByToOrder(order, node.junction.orderBy, node.junction.as, expressions, !usedNestedQuery);
      }
      if (node.orderBy) {
        addOrderByToOrder(order, node.orderBy, node.as, expressions, !usedNestedQuery);
      }
      if ((_ref = node) != null ? (_ref = _ref.junction) != null ? _ref.sortKey : _ref : _ref) {
        addSortKeyToOrder(order, node.junction.sortKey, node.args, node.junction.as, expressions, !usedNestedQuery);
      }
      if (node.sortKey) {
        addSortKeyToOrder(order, node.sortKey, node.args, node.as, expressions, !usedNestedQuery);
      }
    }
  });

  return function handleTable(_x26, _x27, _x28, _x29, _x30, _x31, _x32, _x33, _x34, _x35, _x36) {
    return _ref10.apply(this, arguments);
  };
})();

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _lodash = require('lodash');

var _util = require('../util');

var _shared = require('./shared');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

exports.default = (() => {
  var _ref6 = _asyncToGenerator(function* (topNode, context, options) {
    (0, _util.validateSqlAST)(topNode);

    let dialect = options.dialectModule;

    if (!dialect && options.dialect) {
      dialect = require('./dialects/' + options.dialect);
    }

    let { selections, tables, wheres, order } = yield _stringifySqlAST(null, topNode, [], context, new Set(), [], [], [], options.batchScope, dialect);

    if (!selections.size) return '';

    let sql = 'SELECT\n  ' + [...selections].join(',\n  ') + '\n' + tables.join('\n');

    wheres = (0, _lodash.filter)(wheres);
    if (wheres.length) {
      sql += '\nWHERE ' + wheres.join(' AND ');
    }

    if (order.length) {
      sql += '\nORDER BY ' + (0, _shared.orderColumnsToString)(order, dialect.quote);
    }

    return sql;
  });

  function stringifySqlAST(_x, _x2, _x3) {
    return _ref6.apply(this, arguments);
  }

  return stringifySqlAST;
})();

function addSortKeyToOrder(order, sortKey, args, as, expressions, stripTable) {
  let descending = sortKey.order.toUpperCase() === 'DESC';
  if (args && args.last) {
    descending = !descending;
  }
  for (const column of (0, _util.wrap)(sortKey.key)) {
    const direction = descending ? 'DESC' : 'ASC';
    (0, _shared.addToOrder)(order, column, direction, as, expressions, stripTable);
  }
}

function addOrderByToOrder(order, orderBy, as, expressions, stripTable) {
  for (const column in orderBy) {
    const direction = orderBy[column];
    (0, _shared.addToOrder)(order, column, direction, as, expressions, stripTable);
  }
}