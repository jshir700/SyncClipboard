namespace SyncClipboard.Core.Interfaces;

public interface IContextMenu
{
    public const string DefaultGroupName = "Default Group";
    public void AddMenuItemGroup(MenuItem[] menuItems, string? group = null);
    public void AddMenuItem(MenuItem menuItem, string? group = null);

    /// <summary>
    /// Replace a dynamic section at the start of the menu.
    /// Pass an empty array to remove the section entirely.
    /// </summary>
    public void SetDynamicSection(MenuItem[] items);
}
