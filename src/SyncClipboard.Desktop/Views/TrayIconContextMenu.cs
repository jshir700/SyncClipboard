using Avalonia.Controls;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.Input;
using SyncClipboard.Core.AbstractClasses;
using SyncClipboard.Core.Interfaces;
using System;

namespace SyncClipboard.Desktop.Views;

internal class TrayIconContextMenu : ContextMenuBase
{
    private readonly NativeMenu _menu;
    private readonly int _menuReserveCount;
    private NativeMenuItemSeparator? _dynamicSeparator;
    private int _dynamicItemStart;

    public TrayIconContextMenu()
    {
        var icons = TrayIcon.GetIcons(App.Current);
        var trayIcon = icons?[0];
        var menu = trayIcon?.Menu;
        ArgumentNullException.ThrowIfNull(menu, nameof(menu));
        _menu = menu;
        _menuReserveCount = _menu.Items.Count;
        _dynamicItemStart = _menuReserveCount > 0 ? 0 : 0;
    }

    private void InsertItem(int index, NativeMenuItemBase menuItemBase)
    {
        _menu.Items.Insert(index, menuItemBase);
    }

    private void RemoveItemAt(int index)
    {
        _menu.Items.RemoveAt(index);
    }

    protected override void InsertMenuItem(int index, Core.Interfaces.MenuItem menuitem)
    {
        NativeMenuItem item = new()
        {
            Header = menuitem.Text,
        };

        if (menuitem.Action is not null)
        {
            item.Command = new RelayCommand(menuitem.Action);
        }
        InsertItem((ushort)index, item);
    }

    protected override void InsertSeparator(int index)
    {
        InsertItem(index, new NativeMenuItemSeparator());
    }

    protected override void InsertToggleMenuItem(int index, ToggleMenuItem menuitem)
    {
        NativeMenuItem item = new()
        {
            Header = menuitem.Text,
            IsChecked = menuitem.Checked,
            ToggleType = NativeMenuItemToggleType.CheckBox
        };

        menuitem.CheckedChanged += status => Dispatcher.UIThread.Post(() => item.IsChecked = status);

        if (menuitem.Action is not null)
        {
            item.Command = new RelayCommand(menuitem.Action);
        }
        InsertItem((ushort)index, item);
    }

    protected override int MenuItemsCount()
    {
        return _menu.Items.Count - _menuReserveCount;
    }

    public override void SetDynamicSection(Core.Interfaces.MenuItem[] items)
    {
        // Remove old dynamic section (items + separator) from the top
        var removeCount = 0;
        for (int i = _dynamicItemStart; i < _menu.Items.Count - _menuReserveCount; i++)
        {
            if (_menu.Items[i] is NativeMenuItemSeparator)
            {
                removeCount = (i - _dynamicItemStart) + 1;
                break;
            }
        }

        for (int i = 0; i < removeCount; i++)
        {
            RemoveItemAt(_dynamicItemStart);
        }

        if (items.Length == 0)
        {
            _dynamicSeparator = null;
            return;
        }

        // Insert new items at the top
        for (int i = 0; i < items.Length; i++)
        {
            var nativeItem = new NativeMenuItem
            {
                Header = items[i].Text ?? "",
            };
            if (items[i].Action is not null)
            {
                nativeItem.Command = new RelayCommand(items[i].Action);
            }
            InsertItem(_dynamicItemStart + i, nativeItem);
        }

        // Add separator after dynamic section
        _dynamicSeparator = new NativeMenuItemSeparator();
        InsertItem(_dynamicItemStart + items.Length, _dynamicSeparator);
    }
}
