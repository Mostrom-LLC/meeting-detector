import React, { useEffect, useMemo, useState } from "react";
import { Search, LayoutTemplate, X, Loader2, AlertCircle } from "lucide-react";
import { useTemplates, useTemplate } from "@/hooks/use-templates";
import { toast } from "sonner";

interface TemplateSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateSelect: (templateBlocks: any) => void;
}

export const TemplateSelectionModal: React.FC<TemplateSelectionModalProps> = ({
  isOpen,
  onClose,
  onTemplateSelect,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const {
    data: templates = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useTemplates();

  const {
    data: selectedTemplate,
    isFetching: isLoadingTemplate,
    error: templateError,
  } = useTemplate(selectedTemplateId ?? "");

  // Close on ESC key press
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
    }

    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  // Reset modal state when closed
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setSelectedTemplateId(null);
    }
  }, [isOpen]);

  // Handle template loading success
  useEffect(() => {
    if (!isOpen || !selectedTemplate) return;

    onTemplateSelect(selectedTemplate.blocks ?? []);
    setSelectedTemplateId(null);
    onClose();
  }, [selectedTemplate, isOpen, onTemplateSelect, onClose]);

  // Handle template loading errors
  useEffect(() => {
    if (templateError) {
      toast.error("Failed to load template");
      setSelectedTemplateId(null);
    }
  }, [templateError]);

  const sortedTemplates = useMemo(() => {
    if (!templates) return [];
    return [...templates]
      .filter((template) => !template.deletedAt)
      .sort((a, b) => {
        const nameA = (a.name || "Untitled Template").toLowerCase();
        const nameB = (b.name || "Untitled Template").toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) {
      return sortedTemplates;
    }
    const query = searchQuery.toLowerCase();
    return sortedTemplates.filter((template) =>
      (template.name || "Untitled Template").toLowerCase().includes(query)
    );
  }, [sortedTemplates, searchQuery]);

  const renderTemplateName = (name: string) => {
    if (!searchQuery.trim()) return name;

    const lowerName = name.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();
    const matchIndex = lowerName.indexOf(lowerQuery);

    if (matchIndex === -1) {
      return name;
    }

    const beforeMatch = name.slice(0, matchIndex);
    const matchText = name.slice(matchIndex, matchIndex + searchQuery.length);
    const afterMatch = name.slice(matchIndex + searchQuery.length);

    return (
      <>
        {beforeMatch}
        <span className="text-white">{matchText}</span>
        {afterMatch}
      </>
    );
  };

  if (!isOpen) {
    return null;
  }

  const showEmptyState = !isLoading && !isFetching && sortedTemplates.length === 0;
  const showNoResults = !isLoading && !isFetching && sortedTemplates.length > 0 && filteredTemplates.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#191919] rounded-lg shadow-xl border border-[#2a2a2a] w-[560px] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 bg-[#191919] border-b border-[#252525]">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-[#6b6b6b]" />
            <input
              type="text"
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full pl-7 pr-2 py-1.5 bg-transparent border-none text-[#d4d4d4] placeholder-[#6b6b6b] focus:outline-none text-[13px]"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 p-1 rounded-md text-[#6b6b6b] hover:text-[#d4d4d4] hover:bg-[#252525] focus:outline-none"
            aria-label="Close template selection modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 bg-[#191919]">
          {(isLoading || isFetching) && (
            <div className="flex flex-col items-center justify-center py-12 text-[#6b6b6b] text-[13px]">
              <Loader2 className="w-5 h-5 animate-spin mb-3" />
              Loading templates...
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-[#6b6b6b] text-[13px] space-y-3 px-4 text-center">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <span>Failed to load templates</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-3 py-1.5 text-[13px] rounded-md border border-[#2a2a2a] text-[#d4d4d4] hover:bg-[#252525]"
              >
                Retry
              </button>
            </div>
          )}

          {showEmptyState && (
            <div className="flex flex-col items-center justify-center py-12 text-[#6b6b6b] text-[13px]">
              <LayoutTemplate className="w-10 h-10 text-[#3a3a3a] mb-2" />
              <p>No templates available</p>
            </div>
          )}

          {showNoResults && (
            <div className="flex flex-col items-center justify-center py-12 text-[#6b6b6b] text-[13px]">
              <LayoutTemplate className="w-10 h-10 text-[#3a3a3a] mb-2" />
              <p>No templates found</p>
            </div>
          )}

          {!isLoading && !isFetching && !error && filteredTemplates.length > 0 && (
            <div className="py-1 px-3 space-y-2">
              {filteredTemplates.map((template) => {
                const templateName = template.name || "Untitled Template";
                const isDisabled = isLoadingTemplate && selectedTemplateId === template.id;

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      if (isLoadingTemplate) return;
                      setSelectedTemplateId(template.id);
                    }}
                    className={`group list-item list-item-default w-full text-left flex items-center justify-between ${
                      isDisabled ? "opacity-50 pointer-events-none" : ""
                    }`}
                  >
                    <div className="list-item-icon-group">
                      <LayoutTemplate className="w-4 h-4 text-gray-400" />
                      <span className="list-item-title">
                        {renderTemplateName(templateName)}
                      </span>
                    </div>
                    {isLoadingTemplate && selectedTemplateId === template.id && (
                      <Loader2 className="w-4 h-4 animate-spin text-[#6b6b6b]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-3 py-2 bg-[#191919] border-t border-[#252525]">
          <p className="text-[13px] text-[#6b6b6b] leading-[1.5]">
            Choose a template to populate your note. Your title stays the same.
          </p>
        </div>
      </div>
    </div>
  );
};

