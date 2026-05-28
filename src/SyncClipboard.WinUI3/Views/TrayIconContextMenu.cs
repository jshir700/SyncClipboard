using CommunityToolkit.Mvvm.Input;
using H.NotifyIcon;
using H.NotifyIcon.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using SyncClipboard.Core.AbstractClasses;
using SyncClipboard.Core.Interfaces;
using System;
using System.Reflection;

namespace SyncClipboard.WinUI3.Views
{
    public class TrayIconContextMenu : ContextMenuBase
    {
        private readonly TrayIcon _trayIcon;

        # region H.NotifyIcon.TaskbarIcon反射信息

        private readonly PropertyInfo _pInfoContextMenuFlyout;
        private readonly PropertyInfo _pInfoIsContextMenuVisible;
        private readonly PropertyInfo _pInfoContextMenuWindowHandle;

        private readonly MenuFlyout _menuFlyout;
        private readonly nint _handle;

        private void InsertItem(ushort index, MenuFlyoutItemBase flyoutItemBase)
        {
            PrepareItemForSecondWindow(flyoutItemBase);
            _menuFlyout.Items.Insert(index, flyoutItemBase);
        }

        private void PrepareItemForSecondWindow(MenuFlyoutItemBase flyoutItemBase)
        {
            if (flyoutItemBase is not MenuFlyoutSeparator)
            {
                flyoutItemBase.Height = 32;
                flyoutItemBase.Padding = new Thickness(11, 0, 11, 0);
            }

            flyoutItemBase.Tapped += (_, _) =>
            {
                _pInfoIsContextMenuVisible.SetValue(_trayIcon, false);
                _menuFlyout.Hide();
                _ = WindowUtilities.HideWindow(_handle);
            };
        }

        #endregion

        public TrayIconContextMenu(TrayIcon trayIcon)
        {
            _trayIcon = trayIcon;

            #region 初始化H.NotifyIcon.TaskbarIcon反射信息
            const BindingFlags flags = BindingFlags.NonPublic | BindingFlags.Instance;

            if (typeof(TaskbarIcon).GetProperty("ContextMenuFlyout", flags) is PropertyInfo pInfoContextMenuFlyout &&
                 typeof(TaskbarIcon).GetProperty("IsContextMenuVisible", flags) is PropertyInfo pInfoIsContextMenuVisible &&
                 typeof(TaskbarIcon).GetProperty("ContextMenuWindowHandle", flags) is PropertyInfo pInfoContextMenuWindowHandle)
            {
                _pInfoContextMenuFlyout = pInfoContextMenuFlyout;
                _pInfoIsContextMenuVisible = pInfoIsContextMenuVisible;
                _pInfoContextMenuWindowHandle = pInfoContextMenuWindowHandle;
            }
            else
            {
                throw new Exception("Can not get PropertyInfo? of TrayIcon");
            }

            var handle = _pInfoContextMenuWindowHandle.GetValue(_trayIcon) as nint?;
            if (_pInfoContextMenuFlyout.GetValue(_trayIcon, null) is MenuFlyout menuFlyout && handle is not null)
            {
                _menuFlyout = menuFlyout;
                _handle = handle.Value;
            }
            else
            {
                throw new Exception("Can not get Property of TrayIcon");
            }
            # endregion
        }

        private MenuFlyoutSeparator CreateSeparator()
        {
            return new MenuFlyoutSeparator
            {
                Height = _trayIcon.SeparatorSize.Height,
                MinWidth = _trayIcon.SeparatorSize.Width
            };
        }

        protected override void InsertToggleMenuItem(int index, ToggleMenuItem menuitem)
        {
            ToggleMenuFlyoutItem flyoutItem = new()
            {
                Text = menuitem.Text,
                IsChecked = menuitem.Checked
            };
            menuitem.CheckedChanged += status => flyoutItem.IsChecked = status;

            if (menuitem.Action is not null)
            {
                flyoutItem.Command = new RelayCommand(menuitem.Action);
            }
            InsertItem((ushort)index, flyoutItem);
        }

        protected override void InsertMenuItem(int index, MenuItem menuitem)
        {
            MenuFlyoutItem flyoutItem = new()
            {
                Text = menuitem.Text,
            };

            if (menuitem.Action is not null)
            {
                flyoutItem.Command = new RelayCommand(menuitem.Action);
            }
            InsertItem((ushort)index, flyoutItem);
        }

        protected override void InsertSeparator(int index)
        {
            InsertItem((ushort)index, CreateSeparator());
        }

        protected override int MenuItemsCount()
        {
            return _menuFlyout.Items.Count - 1;
        }

        private MenuFlyoutSeparator? _dynamicSeparator;
        private readonly int _dynamicItemStart = 1;

        public override void SetDynamicSection(Core.Interfaces.MenuItem[] items)
        {
            // Remove old dynamic section (items + separator) after position 0 (reserve index)
            MenuFlyoutSeparator? oldSeparator = null;
            for (int i = _dynamicItemStart; i < _menuFlyout.Items.Count; i++)
            {
                if ((MenuFlyoutSeparator)_menuFlyout.Items[i] is not null && i > _dynamicItemStart)
                {
                    oldSeparator = _menuFlyout.Items[i] as MenuFlyoutSeparator;
                    break;
                }
            }

            var removeEnd = oldSeparator is not null
                ? _menuFlyout.Items.IndexOf(oldSeparator) + 1
                : _menuFlyout.Items.Count;

            for (int i = removeEnd - 1; i >= _dynamicItemStart; i--)
            {
                _menuFlyout.Items.RemoveAt(i);
            }

            if (items.Length == 0)
            {
                _dynamicSeparator = null;
                return;
            }

            // Insert new items after the reserve index
            for (int i = 0; i < items.Length; i++)
            {
                var flyoutItem = new MenuFlyoutItem
                {
                    Text = items[i].Text ?? "",
                    Height = 32,
                    Padding = new Microsoft.UI.Xaml.Thickness(11, 0, 11, 0)
                };
                if (items[i].Action is not null)
                {
                    flyoutItem.Command = new RelayCommand(items[i].Action);
                }
                flyoutItem.Tapped += (_, _) =>
                {
                    _pInfoIsContextMenuVisible.SetValue(_trayIcon, false);
                    _menuFlyout.Hide();
                    _ = WindowUtilities.HideWindow(_handle);
                };
                _menuFlyout.Items.Insert(_dynamicItemStart + i, flyoutItem);
            }

            // Add separator
            _dynamicSeparator = CreateSeparator();
            _menuFlyout.Items.Insert(_dynamicItemStart + items.Length, _dynamicSeparator);
        }
    }
}