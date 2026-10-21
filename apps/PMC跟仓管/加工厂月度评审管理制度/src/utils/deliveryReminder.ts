export interface DeliveryReminderItem { id: string; factoryName: string; craft: string; region: string; orderNo: string; product: string; dueDate: string }
export interface DeliveryReminderFeed { today: string; items: DeliveryReminderItem[]; hasMore: boolean; nameAmbiguous: boolean }
export const deliveryReminderKey = (user: string, item: DeliveryReminderItem) => `${user}:${item.id}:${item.dueDate}`
export const deliveryReminderPage = (path: string) => /^\/orders(?:\/dept\/[^/]+|\/region\/[^/]+\/delayed)?\/?$/.test(path)
