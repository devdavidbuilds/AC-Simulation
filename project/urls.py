"""project URL Configuration"""
from django.contrib import admin
from django.urls import path, include
from refrigerator import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('refrigerator.urls')),
]
