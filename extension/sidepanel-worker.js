import {createSidepanelController} from './sidepanel-controller.js';
const controller=createSidepanelController(chrome);
chrome.runtime.onConnect.addListener(controller.connect);
// Keep the real action event: auto-opening sidePanel consumes this action and
// does not grant activeTab in Chrome. Bind metadata, then open synchronously
// within the user gesture; never read page content during toolbar activation.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
chrome.action.onClicked.addListener(tab=>{
  controller.bindTab(tab);
  if(Number.isInteger(tab.windowId))chrome.sidePanel.open({windowId:tab.windowId}).catch(()=>{});
});
