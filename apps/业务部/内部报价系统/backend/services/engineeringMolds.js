'use strict';

function expandEngineeringMolds(molds) {
  return (Array.isArray(molds) ? molds : []).flatMap(source => {
    const mold = source && typeof source === 'object' ? source : {};
    const common = {
      mold_no: mold.mold_no || '',
      sets: mold.sets ?? 1,
      material: mold.material || '',
      color: mold.color || '',
      material_grade: mold.material_grade || '',
      machine: mold.machine || '',
      machine_model: mold.machine_model || (mold.detail && mold.detail.machine_model) || '',
      target: mold.target ?? (mold.detail && mold.detail.target) ?? null,
      material_unit_price: mold.material_unit_price ?? null,
      shot_price: mold.shot_price ?? null,
      cycle_sec: mold.cycle_sec ?? null,
    };

    if (Array.isArray(mold.parts) && mold.parts.length) {
      return mold.parts.map((sourcePart, partIndex) => {
        const part = sourcePart && typeof sourcePart === 'object' ? sourcePart : {};
        return {
          ...common,
          name: part.name || '',
          material: part.material || common.material,
          color: part.color || common.color,
          material_grade: part.material_grade || common.material_grade,
          cavity: part.cavity || '',
          weight_g: part.weight_g ?? null,
          note: part.note || mold.note || '',
          mold_part_index: partIndex,
          mold_part_count: mold.parts.length,
          shot_price: partIndex === 0 ? common.shot_price : 0,
        };
      });
    }

    return [{
      ...common,
      name: mold.name || '',
      cavity: mold.cavity || '',
      weight_g: mold.weight_g ?? null,
      note: mold.note || '',
    }];
  });
}

module.exports = { expandEngineeringMolds };
