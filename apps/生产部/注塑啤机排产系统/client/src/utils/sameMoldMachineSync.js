export function getSameMoldMachineChange(items, record, newMachineNo) {
  const machineChanged = newMachineNo !== record.machine_no;
  const sameMoldCount = record.mold_name
    ? items.filter(item => item.mold_name === record.mold_name).length
    : 1;
  const shouldSync = machineChanged && sameMoldCount > 1;

  return {
    sameMoldCount,
    shouldConfirm: shouldSync,
    shouldSync,
  };
}
