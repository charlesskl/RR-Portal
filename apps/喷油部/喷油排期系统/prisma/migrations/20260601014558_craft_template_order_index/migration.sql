-- CreateIndex
CREATE INDEX "craft_template_items_templateId_itemOrder_idx" ON "craft_template_items"("templateId", "itemOrder");

-- CreateIndex
CREATE INDEX "craft_template_parts_itemId_partOrder_idx" ON "craft_template_parts"("itemId", "partOrder");
