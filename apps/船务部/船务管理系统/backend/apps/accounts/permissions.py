from rest_framework.permissions import BasePermission


class IsShipping(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'shipping'


class IsSupervisor(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'supervisor'


class IsWarehouseClerk(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'warehouse_clerk'


class IsCargoTracker(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'cargo_tracker'


class IsQC(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'qc'


class IsWarehouseManager(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'warehouse_manager'


class IsCustoms(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'customs'
