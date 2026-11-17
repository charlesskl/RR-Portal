-- 保留历史引用：先确定原记录归属，再为另一厂区所用的产品复制核价和部位。
ALTER TABLE products ADD COLUMN factoryId TEXT NOT NULL DEFAULT 'XINGXIN';
DROP INDEX IF EXISTS products_productNo_key;
DROP INDEX IF EXISTS IX_products_productNo;

CREATE TEMP TABLE product_factory_refs AS
SELECT productId AS oldId, factoryId FROM orders WHERE productId IS NOT NULL
UNION SELECT p.productId, o.factoryId FROM order_part_qtys q JOIN orders o ON o.id=q.orderId JOIN product_parts p ON p.id=q.sourcePartId
UNION SELECT p.productId, s.factoryId FROM production_plans s JOIN product_parts p ON p.id=s.sourcePartId
UNION SELECT productId, factoryId FROM inventory_moves
UNION SELECT p.id, u.factoryId FROM products p JOIN users u ON u.username=p.createdBy WHERE u.factoryId IN ('XINGXIN','HUADENG');

-- 创建账号有明确归属时优先；否则仅在所有引用均属华登时归华登；无依据的旧记录沿用兴信。
UPDATE products SET factoryId=COALESCE(
  (SELECT u.factoryId FROM users u WHERE u.username=products.createdBy AND u.factoryId IN ('XINGXIN','HUADENG')),
  (SELECT CASE WHEN MIN(r.factoryId)='HUADENG' AND MAX(r.factoryId)='HUADENG' THEN 'HUADENG' ELSE 'XINGXIN' END FROM product_factory_refs r WHERE r.oldId=products.id), 'XINGXIN');

CREATE TEMP TABLE product_factory_copies AS
SELECT r.oldId, r.factoryId, (SELECT COALESCE(MAX(id),0) FROM products)+ROW_NUMBER() OVER(ORDER BY r.oldId,r.factoryId) AS newId
FROM product_factory_refs r JOIN products p ON p.id=r.oldId
WHERE r.factoryId IN ('XINGXIN','HUADENG') AND r.factoryId<>p.factoryId;

INSERT INTO products(id,productNo,iterationNo,status,effectiveDate,remark,createdBy,createdAt,lastUpdatedBy,updatedAt,factoryId)
SELECT c.newId,p.productNo,p.iterationNo,p.status,p.effectiveDate,p.remark,p.createdBy,p.createdAt,p.lastUpdatedBy,p.updatedAt,c.factoryId
FROM product_factory_copies c JOIN products p ON p.id=c.oldId;

CREATE TEMP TABLE product_part_copies AS
SELECT p.id AS oldId,c.newId AS productId,c.factoryId,
 (SELECT COALESCE(MAX(id),0) FROM product_parts)+ROW_NUMBER() OVER(ORDER BY c.newId,p.id) AS newId
FROM product_factory_copies c JOIN product_parts p ON p.productId=c.oldId;

INSERT INTO product_parts(id,productId,partGroupId,partName,partOrder,unitCost,laborPrice,paintCost,quotedPrice,craft,craftDetail,dailyCapacity,productionMode,stdMachineCount,isTumbler,craftPasses,remark)
SELECT c.newId,c.productId,COALESCE((SELECT g.newId FROM product_part_copies g WHERE g.oldId=p.partGroupId AND g.productId=c.productId),p.partGroupId),
 p.partName,p.partOrder,p.unitCost,p.laborPrice,p.paintCost,p.quotedPrice,p.craft,p.craftDetail,p.dailyCapacity,p.productionMode,p.stdMachineCount,p.isTumbler,p.craftPasses,p.remark
FROM product_part_copies c JOIN product_parts p ON p.id=c.oldId;

UPDATE orders SET productId=(SELECT c.newId FROM product_factory_copies c WHERE c.oldId=orders.productId AND c.factoryId=orders.factoryId)
WHERE EXISTS(SELECT 1 FROM product_factory_copies c WHERE c.oldId=orders.productId AND c.factoryId=orders.factoryId);
UPDATE order_part_qtys SET sourcePartId=(SELECT c.newId FROM product_part_copies c JOIN orders o ON o.id=order_part_qtys.orderId WHERE c.oldId=order_part_qtys.sourcePartId AND c.factoryId=o.factoryId)
WHERE EXISTS(SELECT 1 FROM product_part_copies c JOIN orders o ON o.id=order_part_qtys.orderId WHERE c.oldId=order_part_qtys.sourcePartId AND c.factoryId=o.factoryId);
UPDATE production_plans SET sourcePartId=(SELECT c.newId FROM product_part_copies c WHERE c.oldId=production_plans.sourcePartId AND c.factoryId=production_plans.factoryId)
WHERE EXISTS(SELECT 1 FROM product_part_copies c WHERE c.oldId=production_plans.sourcePartId AND c.factoryId=production_plans.factoryId);
UPDATE inventory_moves SET productId=(SELECT c.newId FROM product_factory_copies c WHERE c.oldId=inventory_moves.productId AND c.factoryId=inventory_moves.factoryId)
WHERE EXISTS(SELECT 1 FROM product_factory_copies c WHERE c.oldId=inventory_moves.productId AND c.factoryId=inventory_moves.factoryId);

CREATE UNIQUE INDEX products_factoryId_productNo_key ON products(factoryId,productNo);
DROP TABLE product_part_copies;
DROP TABLE product_factory_copies;
DROP TABLE product_factory_refs;
