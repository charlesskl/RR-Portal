using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

public abstract class MasterEntity
{
    [Key, Column("ID"), DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public long ID { get; set; }
}
