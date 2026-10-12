import { AdminGroup, AdminResource, AdminResourceBase, type FieldsConfig, type ListConfig } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './employee.entity.js';

/**
 * `salary` is `sensitive`: whoever may view employees sees it on the record as usual, but a change to it is recorded
 * in the audit log as "changed", without the old or the new value (History tab, audit page, and the table itself).
 */
@AdminResource(Employee, { icon: 'user', label: { en: 'Employee', fa: 'کارمند' }, title: 'name' })
export class EmployeeAdmin extends AdminResourceBase<Employee> {
  list: ListConfig<Employee> = { columns: ['id', 'name', 'position', 'hiredOn'], sort: 'name', search: ['name', 'position'] };
  fields: FieldsConfig<Employee> = {
    name: { label: { en: 'Name', fa: 'نام' } },
    position: { label: { en: 'Position', fa: 'سمت' } },
    salary: { widget: 'money', currency: 'USD', label: { en: 'Salary', fa: 'حقوق' }, sensitive: true },
    hiredOn: { label: { en: 'Hired on', fa: 'تاریخ استخدام' } },
  };
}

@AdminGroup({ label: { en: 'Staff', fa: 'کارکنان' }, icon: 'users' })
@Module({ imports: [TypeOrmModule.forFeature([Employee])], providers: [EmployeeAdmin] })
export class StaffModule {}
